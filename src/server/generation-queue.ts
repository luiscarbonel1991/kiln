import type { Card } from "@/domain/card";
import {
  estimateGeneration,
  type ImagePrice,
  imagePrice,
  toMicros,
} from "@/domain/generation-cost";
import {
  buildGenerationRequest,
  type GenerationRequest,
} from "@/domain/generation-request";
import { SEED_BRAND } from "@/domain/seed";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { findRecipe, SEED_RECIPES } from "@/lib/recipes";
import { storeAsset } from "@/providers/asset-bytes";
import { providerMode } from "@/providers/mode";
import { getImageProvider } from "@/providers/registry";
import {
  budget,
  claimJobs,
  completeJob,
  enqueueBatch,
  failJob,
  recordCost,
  renewLease,
  requeueExpired,
} from "@/server/generation-repository";
import { createWorker, type Worker } from "@/server/generation-worker";
import { getCurrentMaker } from "@/server/maker-repository";
import { loadProject } from "@/server/project-repository";

// The queue's entry points for the app: estimate and enqueue a planned
// project's cards, and the per-process worker.

export interface CardEstimate {
  cardId: string;
  request: GenerationRequest;
  typicalMicros: number;
  maxMicros: number;
}

// Build the exact request each card would pay for, from the saved project
// (the client flushes its autosave first), with its estimate.
export async function estimateProjectCards(
  projectId: string,
  cardIds: string[],
): Promise<{
  cards: CardEstimate[];
  model: string;
  quality: ImagePrice["quality"];
}> {
  const project = await loadProject(projectId);
  if (!project?.master || !project.understanding) {
    throw new Error("The project needs a reference image first.");
  }
  const { master, understanding } = project;
  const byId = new Map(project.cards.map((c) => [c.id, c]));
  const cards = cardIds.map((id) => {
    const card: Card | undefined = byId.get(id);
    if (!card || card.type !== "image") {
      throw new Error(`"${id}" is not an image card of this project.`);
    }
    const request = buildGenerationRequest({
      card,
      master,
      understanding,
      recipe: findRecipe(card.recipeId) ?? SEED_RECIPES[0],
      brand: SEED_BRAND,
    });
    const estimate = estimateGeneration(request.model, request.model.aspect);
    if (!estimate) {
      throw new Error(`No pinned price for ${request.model.model}.`);
    }
    return {
      cardId: id,
      request,
      typicalMicros: toMicros(estimate.typical),
      maxMicros: toMicros(estimate.max),
    };
  });
  const first = cards[0]?.request.model;
  return {
    cards,
    model: first?.model ?? "",
    quality: first ? (imagePrice(first)?.quality ?? null) : null,
  };
}

// Queue a planned project's cards as one batch and wake the worker.
export async function enqueueProjectCards(input: {
  projectId: string;
  cardIds: string[];
  shownMaxMicros?: number;
}) {
  const maker = await getCurrentMaker();
  const planned = await db.project.findFirst({
    where: { id: input.projectId, makerId: maker.id },
    select: { plan: true },
  });
  if (!planned || planned.plan === null) {
    throw new Error("Only a planned project generates through the queue.");
  }
  const { cards, model } = await estimateProjectCards(
    input.projectId,
    input.cardIds,
  );
  const result = await enqueueBatch({
    makerId: maker.id,
    projectId: input.projectId,
    mode: providerMode(),
    model,
    jobs: cards.map((c) => ({
      cardId: c.cardId,
      request: c.request,
      estimateMicros: c.maxMicros,
    })),
    shownMaxMicros: input.shownMaxMicros,
  });
  ensureGenerationWorker()?.wake();
  return result;
}

const globalForWorker = globalThis as unknown as {
  kilnGenerationWorker?: Worker;
};

// The process's worker (started from instrumentation, or lazily on the first
// enqueue). null without a database.
export function ensureGenerationWorker(): Worker | null {
  if (!env.DATABASE_URL) return null;
  if (!globalForWorker.kilnGenerationWorker) {
    const worker = createWorker({
      mode: providerMode(),
      concurrency: env.KILN_GENERATION_CONCURRENCY,
      leaseSec: 120,
      renewMs: 30_000,
      sweepMs: 20_000,
      callTimeoutMs: 180_000,
      claimJobs,
      renewLease,
      recordCost,
      completeJob,
      failJob,
      requeueExpired,
      overCap: async (makerId) => {
        const b = await budget(makerId);
        return b.spentMicros >= b.capMicros;
      },
      provider: (id) => getImageProvider(id),
      storeAsset,
      log: (message, error) =>
        console.warn(`[kiln queue] ${message}`, error ?? ""),
    });
    globalForWorker.kilnGenerationWorker = worker;
    process.once("SIGTERM", () => worker.stop());
    worker.wake();
  }
  return globalForWorker.kilnGenerationWorker;
}

import type { Card } from "@/domain/card";
import {
  estimateGeneration,
  estimateVideo,
  type ImagePrice,
  imagePrice,
  toMicros,
} from "@/domain/generation-cost";
import {
  buildGenerationRequest,
  buildVideoRequest,
  type GenerationRequest,
  VideoNeedsScene,
} from "@/domain/generation-request";
import { parseSlotCardId, slotCardId, videoSettings } from "@/domain/plan";
import { SEED_BRAND } from "@/domain/seed";
import { db, hasDatabase } from "@/lib/db";
import { env } from "@/lib/env";
import { CATALOG, findRecipe, SEED_RECIPES } from "@/lib/recipes";
import { storeAsset } from "@/providers/asset-bytes";
import { providerMode } from "@/providers/mode";
import { getImageProvider, getVideoProvider } from "@/providers/registry";
import {
  budget,
  claimJobs,
  completeJob,
  enqueueBatch,
  failJob,
  markCallStarted,
  QueueRefusal,
  recordCost,
  renewLease,
  requeueExpired,
} from "@/server/generation-repository";
import { createWorker, type Worker } from "@/server/generation-worker";
import { getCurrentMaker } from "@/server/maker-repository";
import { loadProject, loadProjectBoard } from "@/server/project-repository";

// The queue's entry points for the app: estimate and enqueue a planned
// project's cards, and the per-process worker.

// A model the batch runs, with its pinned quality and how many cards use it.
export interface BatchModel {
  model: string;
  quality: ImagePrice["quality"];
  count: number;
}

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
  // Every model the cards run (not only the first card's), and the batch's
  // label for them.
  models: BatchModel[];
  model: string;
}> {
  const project = await loadProject(projectId);
  if (!project?.master || !project.understanding) {
    throw new Error("The project needs a reference image first.");
  }
  const { master, understanding } = project;
  const byId = new Map(project.cards.map((c) => [c.id, c]));
  // A video is built from the board (its plan slot, the approved scene it
  // starts from) and the product's spec.
  let board: Awaited<ReturnType<typeof loadProjectBoard>> | undefined;
  const videoEstimate = async (card: Card): Promise<CardEstimate> => {
    board ??= await loadProjectBoard(projectId);
    const ref = parseSlotCardId(card.id);
    const destination = board?.board.plan?.destinations.find(
      (d) => d.destinationId === ref?.destinationId,
    );
    const slot = destination?.slots.find((s) => s.key === ref?.slotKey);
    if (!board?.product || !destination || slot?.fill !== "video") {
      throw new Error(`"${card.id}" is not a video slot of this project.`);
    }
    const settings = videoSettings(
      destination,
      slot,
      CATALOG.destinations.find((d) => d.id === destination.destinationId)
        ?.video,
    );
    const source = settings.from
      ? byId.get(slotCardId(destination.destinationId, settings.from))
      : undefined;
    let request: GenerationRequest;
    try {
      request = buildVideoRequest({
        product: board.product,
        settings,
        scene: source?.fields.scene.value,
        model: card.model,
      });
    } catch (error) {
      if (error instanceof VideoNeedsScene) {
        throw new QueueRefusal("needs-scene", error.message);
      }
      throw error;
    }
    const usd = estimateVideo(request.model, request.durationSec);
    if (usd === null) {
      throw new Error(`No pinned price for ${request.model.model}.`);
    }
    return {
      cardId: card.id,
      request,
      typicalMicros: toMicros(usd),
      maxMicros: toMicros(usd),
    };
  };
  const cards: CardEstimate[] = [];
  for (const id of cardIds) {
    const card: Card | undefined = byId.get(id);
    if (card?.type === "video") {
      cards.push(await videoEstimate(card));
      continue;
    }
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
    cards.push({
      cardId: id,
      request,
      typicalMicros: toMicros(estimate.typical),
      maxMicros: toMicros(estimate.max),
    });
  }
  const models = new Map<string, BatchModel>();
  for (const { request } of cards) {
    const seen = models.get(request.model.model);
    if (seen) seen.count++;
    else {
      models.set(request.model.model, {
        model: request.model.model,
        quality:
          request.kind === "image"
            ? (imagePrice(request.model)?.quality ?? null)
            : null,
        count: 1,
      });
    }
  }
  const list = [...models.values()];
  return { cards, models: list, model: list.map((m) => m.model).join(", ") };
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
  if (!hasDatabase()) return null;
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
      markCallStarted,
      recordCost,
      completeJob,
      failJob,
      requeueExpired,
      overCap: async (makerId) => {
        const b = await budget(makerId);
        return b.spentMicros >= b.capMicros;
      },
      provider: (id) => getImageProvider(id),
      videoProvider: (id) => getVideoProvider(id),
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

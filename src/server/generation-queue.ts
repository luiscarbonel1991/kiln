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
import {
  checkModel,
  type ModelKind,
  modelLabel,
  PROVIDER_LABELS,
  type ProviderId,
} from "@/domain/model-defaults";
import { parseSlotCardId, slotCardId, videoSettings } from "@/domain/plan";
import { SEED_BRAND } from "@/domain/seed";
import { db, hasDatabase } from "@/lib/db";
import { env } from "@/lib/env";
import { CATALOG, findRecipe, SEED_RECIPES } from "@/lib/recipes";
import { storeAsset } from "@/providers/asset-bytes";
import { hasProviderKey } from "@/providers/keys";
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

// A model the batch runs, with what prices it (an image's quality, a video's
// resolution) and how many cards use it.
export interface BatchModel {
  provider: ProviderId;
  model: string;
  label: string;
  quality: ImagePrice["quality"];
  resolution: string | null;
  count: number;
}

export interface CardEstimate {
  cardId: string;
  request: GenerationRequest;
  typicalMicros: number;
  maxMicros: number;
}

// "openai gpt-image-2 medium", "google veo-3.1-fast-generate-preview 720p".
const batchLabel = (m: BatchModel) =>
  [m.provider, m.model, m.quality, m.resolution].filter(Boolean).join(" ");

// A card's model must be one Kiln offers for its kind, and in a live run its
// provider needs a key: refused with the reason, never swapped for another.
function assertRunnable(
  model: { provider: ProviderId; model: string },
  kind: ModelKind,
  cardId: string,
): void {
  const check = checkModel(model, kind);
  if (!check.ok) {
    throw new QueueRefusal("model", `${cardId}: ${check.message}`);
  }
  if (providerMode() === "live" && !hasProviderKey(model.provider)) {
    const key =
      model.provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY";
    throw new QueueRefusal(
      "provider",
      `${cardId} uses ${check.entry.label}, but ${PROVIDER_LABELS[model.provider]} has no API key (${key}).`,
    );
  }
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
    assertRunnable(card.model, "video", card.id);
    const settings = videoSettings(
      destination,
      slot,
      CATALOG.destinations.find((d) => d.id === destination.destinationId)
        ?.video,
      card.model,
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
      throw new QueueRefusal(
        "model",
        `No pinned price for ${modelLabel(request.model)} at ${request.durationSec} s.`,
      );
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
    assertRunnable(card.model, "image", card.id);
    const request = buildGenerationRequest({
      card,
      master,
      understanding,
      recipe: findRecipe(card.recipeId) ?? SEED_RECIPES[0],
      brand: SEED_BRAND,
    });
    const estimate = estimateGeneration(request.model, request.model.aspect);
    if (!estimate) {
      throw new QueueRefusal(
        "model",
        `No pinned price for ${modelLabel(request.model)}.`,
      );
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
    const entry: BatchModel = {
      provider: request.model.provider,
      model: request.model.model,
      label: modelLabel(request.model),
      quality:
        request.kind === "image"
          ? (imagePrice(request.model)?.quality ?? null)
          : null,
      resolution:
        request.kind === "video" ? (request.model.resolution ?? "720p") : null,
      count: 1,
    };
    const key = batchLabel(entry);
    const seen = models.get(key);
    if (seen) seen.count++;
    else models.set(key, entry);
  }
  const list = [...models.values()];
  return {
    cards,
    models: list,
    model: list.map((m) => `${batchLabel(m)} ×${m.count}`).join(", "),
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

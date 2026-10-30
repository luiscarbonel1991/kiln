import { randomUUID } from "node:crypto";
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
  buildVersionRequest,
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
import {
  canRunRequest,
  type RouteEntry,
  roleRoute,
  routeCandidates,
  worstCase,
} from "@/domain/model-routing";
import {
  parseSlotCardId,
  slotCardId,
  versionSource,
  videoSettings,
} from "@/domain/plan";
import { SEED_BRAND } from "@/domain/seed";
import { cardReference } from "@/lib/card-reference";
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
  fallBackJob,
  markCallStarted,
  QueueRefusal,
  recordCost,
  renewLease,
  requeueExpired,
} from "@/server/generation-repository";
import { createWorker, type Worker } from "@/server/generation-worker";
import { getCurrentMaker, getMakerRoutes } from "@/server/maker-repository";
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
  // The worst case along its route: one charged call at most, so the dearest
  // model's max (its own when it does not fall back).
  maxMicros: number;
  // The models it may move to, in order (Settings → Models).
  next: RouteEntry[];
}

// A model some of the batch's cards may move to, and how many.
export interface BatchFallback {
  label: string;
  count: number;
}

// Whether a model of a route may run this request now: one Kiln offers for the
// request's kind, priced for it and able to take it, its provider keyed in a
// live run (and, for a video, able to render).
export function runnableEntry(
  entry: RouteEntry,
  request: GenerationRequest,
): boolean {
  return (
    checkModel(entry, request.kind).ok &&
    canRunRequest(entry, request) &&
    (providerMode() === "mock" || hasProviderKey(entry.provider)) &&
    (request.kind === "image" || getVideoProvider(entry.provider) !== undefined)
  );
}

// The card's own model first, then the models after it in its role's route
// (final for a scene, video for a video) that may run its request.
export function cardRoute(
  request: GenerationRequest,
  routes: Awaited<ReturnType<typeof getMakerRoutes>>,
): { next: RouteEntry[]; maxMicros: number | null } {
  const { provider, model, quality, resolution } = request.model;
  const start: RouteEntry = {
    provider,
    model,
    ...(quality ? { quality } : {}),
    ...(resolution ? { resolution } : {}),
  };
  const role = request.kind === "video" ? "video" : "final";
  const next = routeCandidates(roleRoute(routes, role), start)
    .slice(1)
    .filter((entry) => runnableEntry(entry, request));
  const worst = worstCase(request, [start, ...next]);
  return { next, maxMicros: worst === null ? null : toMicros(worst) };
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
  // The models cards may move to along their routes.
  fallbacks: BatchFallback[];
}> {
  const project = await loadProject(projectId);
  const routes = await getMakerRoutes();
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
    const route = cardRoute(request, routes);
    return {
      cardId: card.id,
      request,
      typicalMicros: toMicros(usd),
      maxMicros: route.maxMicros ?? toMicros(usd),
      next: route.next,
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
    // A scene looking down edits Kiln's view from above, when there is one.
    board ??= await loadProjectBoard(projectId);
    const plan = board?.board.plan;
    const ref = parseSlotCardId(card.id);
    const slot = plan?.destinations
      .find((d) => d.destinationId === ref?.destinationId)
      ?.slots.find((s) => s.key === ref?.slotKey);
    // A version re-frames its source's approved scene, so it waits for it.
    const source =
      plan && slot?.versionOf ? versionSource(plan, slot) : undefined;
    if (slot?.versionOf && !source?.slot.approvedOutput) {
      throw new QueueRefusal(
        "needs-scene",
        `Approve "${source?.slot.label ?? slot.versionOf}" first: "${slot.label}" re-frames it.`,
      );
    }
    const request =
      slot?.versionOf && source?.slot.approvedOutput && board?.product
        ? buildVersionRequest({
            product: board.product,
            sourceOutput: source.slot.approvedOutput,
            aspect: slot.aspect ?? card.model.aspect,
            text: Boolean(slot.textTemplate),
            model: card.model,
          })
        : buildGenerationRequest({
            card,
            master: plan ? cardReference(plan, card.id, master) : master,
            understanding,
            recipe: findRecipe(card.recipeId) ?? SEED_RECIPES[0],
            brand: SEED_BRAND,
          });
    const estimate = estimateGeneration(
      request.model,
      request.model.aspect,
      request.imageInputs.length,
    );
    if (!estimate) {
      throw new QueueRefusal(
        "model",
        `No pinned price for ${modelLabel(request.model)}.`,
      );
    }
    const route = cardRoute(request, routes);
    cards.push({
      cardId: id,
      request,
      typicalMicros: toMicros(estimate.typical),
      maxMicros: route.maxMicros ?? toMicros(estimate.max),
      next: route.next,
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
  const fallbacks = new Map<string, BatchFallback>();
  for (const { next } of cards) {
    for (const entry of next) {
      const label = modelLabel(entry);
      const seen = fallbacks.get(label);
      if (seen) seen.count++;
      else fallbacks.set(label, { label, count: 1 });
    }
  }
  return {
    cards,
    models: list,
    model: list.map((m) => `${batchLabel(m)} ×${m.count}`).join(", "),
    fallbacks: [...fallbacks.values()],
  };
}

// Queue a planned project's cards, or a design's drawings (an agent's draw:
// the studio shows the job and saves around its result), as one batch and
// wake the worker.
export async function enqueueProjectCards(input: {
  projectId: string;
  cardIds: string[];
  shownMaxMicros?: number;
}) {
  const maker = await getCurrentMaker();
  const planned = await db.project.findFirst({
    where: { id: input.projectId, makerId: maker.id },
    select: { plan: true, type: true },
  });
  if (!planned || (planned.plan === null && planned.type !== "design")) {
    throw new Error(
      "Only a planned project or a design generates through the queue.",
    );
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
      next: c.next,
    })),
    shownMaxMicros: input.shownMaxMicros,
  });
  ensureGenerationWorker()?.wake();
  return result;
}

const globalForWorker = globalThis as unknown as {
  kilnGenerationWorker?: Worker;
  kilnGenerationWorkerCode?: string;
};

// One token per evaluation of this module. The worker outlives a code reload
// (a globalThis singleton; dev HMR re-evaluates modules, never the running
// worker), so it would keep running the old code. The next enqueue under new
// code stops it — it takes no new job and finishes the ones it holds — and
// starts one with the current code. (Instrumentation evaluates its own copy,
// so the first enqueue after a start restarts it once; harmless.)
const WORKER_CODE = randomUUID();

// The process's worker (started from instrumentation, or lazily on the first
// enqueue), always running this code. null without a database.
export function ensureGenerationWorker(): Worker | null {
  if (!hasDatabase()) return null;
  const running = globalForWorker.kilnGenerationWorker;
  if (running && globalForWorker.kilnGenerationWorkerCode !== WORKER_CODE) {
    running.stop();
    globalForWorker.kilnGenerationWorker = undefined;
    console.info(
      "[kiln queue] the generation worker restarted with the current code",
    );
  }
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
      fallBack: fallBackJob,
      runnable: runnableEntry,
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
    globalForWorker.kilnGenerationWorkerCode = WORKER_CODE;
    process.once("SIGTERM", () => worker.stop());
    worker.wake();
  }
  return globalForWorker.kilnGenerationWorker;
}

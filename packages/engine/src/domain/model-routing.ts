import { z } from "zod";
import { PROVIDER_CAPABILITIES } from "@/domain/capabilities";
import { DEFAULT_EFFORT, Effort } from "@/domain/effort";
import {
  estimateGeneration,
  estimateVideo,
  modelPriced,
  type TextCallKind,
} from "@/domain/generation-cost";
import type { GenerationRequest } from "@/domain/generation-request";
import {
  checkModel,
  ImageQuality,
  type MakerModels,
  type ModelKind,
  makerModels,
  modelEntry,
  modelLabel,
  PROVIDER_LABELS,
  ProviderId,
  VideoResolution,
} from "@/domain/model-defaults";
import {
  classifyGenerationError,
  hadResponse,
  isKeyRejected,
  isOutOfCredit,
  type RanOn,
} from "@/domain/queue";

export type { RanOn };

// Model routing (ROADMAP "Agents and model routing", Luis 2026-10-29): a task
// names a role, never a model; each role has a route the maker saved, an
// ordered list of catalog models. A failure another model can fix moves to the
// next one in the route; nothing outside the route ever runs, and nothing runs
// on a route the maker has not saved. Pure: the queue, the text calls and the
// settings page decide with these.

export const ModelRole = z.enum(["fast", "deep", "draft", "final", "video"]);
export type ModelRole = z.infer<typeof ModelRole>;

export const ROLE_KIND: Record<ModelRole, ModelKind> = {
  fast: "text",
  deep: "text",
  draft: "image",
  final: "image",
  video: "video",
};

// A field suggestion and a chat turn run on `fast`; a read of the photo, a
// plan, the art director, the listing text and a chat turn planned first on
// `deep`.
export const TEXT_CALL_ROLES: Record<TextCallKind, "fast" | "deep"> = {
  vision: "deep",
  productDraft: "deep",
  artDirection: "deep",
  listingCopy: "deep",
  productReview: "fast",
  chatTurn: "fast",
  chatPlan: "deep",
};

export const MAX_ROUTE = 4;

export const RouteEntry = z.object({
  provider: ProviderId,
  model: z.string().min(1),
  quality: ImageQuality.optional(),
  resolution: VideoResolution.optional(),
});
export type RouteEntry = z.infer<typeof RouteEntry>;

export const Route = z.object({
  models: z.array(RouteEntry).min(1).max(MAX_ROUTE),
  // Whether a failure moves to the next model. Off for images and video until
  // the maker turns it on: another model changes the look.
  fallback: z.boolean(),
  // A text route's effort (domain/effort.ts), on every model of the route;
  // low when missing. Never on an image or video route.
  effort: Effort.optional(),
});
export type Route = z.infer<typeof Route>;

export const routeEffort = (route: Route | null | undefined): Effort =>
  route?.effort ?? DEFAULT_EFFORT;

export const sameModel = (
  a: { provider: string; model: string },
  b: { provider: string; model: string },
) => a.provider === b.provider && a.model === b.model;

// Only what prices the entry for its kind: a quality on an OpenAI image, a
// resolution on a video, nothing on text.
export function routeEntry(entry: RouteEntry, kind: ModelKind): RouteEntry {
  const { provider, model } = entry;
  if (kind === "image" && entry.quality && provider === "openai") {
    return { provider, model, quality: entry.quality };
  }
  if (kind === "video" && entry.resolution) {
    return { provider, model, resolution: entry.resolution };
  }
  return { provider, model };
}

// Why an entry cannot be in a route of this kind; null when it can.
export function entryProblem(
  entry: RouteEntry,
  kind: ModelKind,
): string | null {
  const check = checkModel(entry, kind);
  if (!check.ok) return check.message;
  if (!modelPriced(entry, kind)) {
    return `${check.entry.label} has no pinned price, so it cannot run.`;
  }
  return null;
}

const ROUTES_SHAPE = Object.fromEntries(
  ModelRole.options.map((role) => [role, Route]),
) as Record<ModelRole, typeof Route>;

// What is wrong with one route of a kind, each issue at its path.
function routeIssues(
  route: Route,
  kind: ModelKind,
  name: string,
  issue: (path: (string | number)[], message: string) => void,
): void {
  if (kind !== "text" && route.effort) {
    issue(["effort"], `An effort is for text; the ${name} route has none.`);
  }
  route.models.forEach((entry, i) => {
    const problem = entryProblem(entry, kind);
    if (problem) issue(["models", i], problem);
    if (route.models.findIndex((m) => sameModel(m, entry)) !== i) {
      issue(
        ["models", i],
        `${modelLabel(entry)} is in the ${name} route twice.`,
      );
    }
  });
}

export const MakerRoutes = z.object(ROUTES_SHAPE).superRefine((routes, ctx) => {
  for (const role of ModelRole.options) {
    routeIssues(routes[role], ROLE_KIND[role], role, (path, message) =>
      ctx.addIssue({ code: "custom", path: [role, ...path], message }),
    );
  }
});
export type MakerRoutes = z.infer<typeof MakerRoutes>;

// Each chat agent's own text route, by the agent's id (Luis, 2026-10-31:
// every agent may run on any text model, at its own effort). An agent with
// none follows the fast route, or deep when the maker plans first.
export const AgentRoutes = z
  .record(z.string().min(1), Route)
  .superRefine((agents, ctx) => {
    for (const [id, route] of Object.entries(agents)) {
      routeIssues(route, "text", id, (path, message) =>
        ctx.addIssue({ code: "custom", path: [id, ...path], message }),
      );
    }
  });
export type AgentRoutes = z.infer<typeof AgentRoutes>;

// Whether every model of a route reads images (an agent that looks at takes
// needs it).
export const routeSees = (route: Route): boolean =>
  route.models.every((m) => modelEntry(m)?.sees === true);

const headOf = (models: MakerModels, kind: ModelKind): RouteEntry =>
  routeEntry(models[kind], kind);

// One saved route, read leniently: an entry Kiln no longer offers or prices
// is dropped, and so is a repeat; null when nothing is left.
function readRoute(raw: unknown, kind: ModelKind): Route | null {
  const parsed = z
    .object({ models: z.array(z.unknown()), fallback: z.boolean() })
    .safeParse(raw);
  const effort = Effort.safeParse((raw as { effort?: unknown } | null)?.effort);
  const models: RouteEntry[] = [];
  for (const item of parsed.success ? parsed.data.models : []) {
    const entry = RouteEntry.safeParse(item);
    if (!entry.success || entryProblem(entry.data, kind)) continue;
    if (models.some((m) => sameModel(m, entry.data))) continue;
    models.push(routeEntry(entry.data, kind));
  }
  if (models.length === 0) return null;
  return {
    models: models.slice(0, MAX_ROUTE),
    fallback: parsed.success ? parsed.data.fallback : false,
    ...(kind === "text" && effort.success ? { effort: effort.data } : {}),
  };
}

// The saved routes, each read leniently; a role left with nothing reads as
// its kind's default alone, with no fallback (a text role keeps its effort).
// null when no route was ever saved.
export function readRoutes(
  raw: unknown,
  defaults: MakerModels,
): MakerRoutes | null {
  if (!raw || typeof raw !== "object") return null;
  const saved = raw as Record<string, unknown>;
  const read = (role: ModelRole): Route => {
    const kind = ROLE_KIND[role];
    const route = readRoute(saved[role], kind);
    if (route) return route;
    const effort = Effort.safeParse(
      (saved[role] as { effort?: unknown } | null)?.effort,
    );
    return {
      models: [headOf(defaults, kind)],
      fallback: false,
      ...(kind === "text" && effort.success ? { effort: effort.data } : {}),
    };
  };
  return Object.fromEntries(
    ModelRole.options.map((role) => [role, read(role)]),
  ) as MakerRoutes;
}

// The agents' own routes, each read leniently; an agent left with nothing
// follows the fast route again.
export function readAgentRoutes(raw: unknown): AgentRoutes {
  if (!raw || typeof raw !== "object") return {};
  const agents: AgentRoutes = {};
  for (const [id, saved] of Object.entries(raw)) {
    const route = readRoute(saved, "text");
    if (route) agents[id] = route;
  }
  return agents;
}

// The defaults a saved route implies: what a new card starts on and what a
// one-model call runs on are the heads of `final`, `video` and `deep`, so a
// default and a route never disagree.
export function routeHeads(routes: MakerRoutes): MakerModels {
  const [image] = routes.final.models;
  const [video] = routes.video.models;
  const [text] = routes.deep.models;
  return {
    image: {
      provider: image.provider,
      model: image.model,
      ...(image.quality ? { quality: image.quality } : {}),
    },
    video: {
      provider: video.provider,
      model: video.model,
      ...(video.resolution ? { resolution: video.resolution } : {}),
    },
    text: { provider: text.provider, model: text.model },
  };
}

// A maker's stored models: the defaults per kind, the routes when saved and
// the agents' own routes (`routes` and `agents` beside the defaults in the
// same blob). With routes, the defaults are their heads.
export function readMakerModels(raw: unknown): {
  models: MakerModels;
  routes: MakerRoutes | null;
  agents: AgentRoutes;
} {
  const base = makerModels(raw);
  const saved = raw as { routes?: unknown; agents?: unknown } | null;
  const routes = readRoutes(saved?.routes, base);
  return {
    models: routes ? routeHeads(routes) : base,
    routes,
    agents: readAgentRoutes(saved?.agents),
  };
}

// The route a role runs on; null when the maker never saved routes (then a
// task runs its one model, as before routing).
export function roleRoute(
  routes: MakerRoutes | null,
  role: ModelRole,
): Route | null {
  return routes ? routes[role] : null;
}

type Pair = Record<ProviderId, RouteEntry>;

const DEEP: Pair = {
  openai: { provider: "openai", model: "gpt-6.1-sol" },
  google: { provider: "google", model: "gemini-3.8-flash" },
};
const FAST: Pair = {
  openai: { provider: "openai", model: "gpt-6-luna" },
  google: { provider: "google", model: "gemini-3.5-flash-lite" },
};
const FINAL: Pair = {
  openai: { provider: "openai", model: "gpt-image-2", quality: "medium" },
  google: { provider: "google", model: "gemini-3.1-flash-image" },
};
const DRAFT: Pair = {
  openai: { provider: "openai", model: "gpt-image-2", quality: "low" },
  google: { provider: "google", model: "gemini-3.1-flash-lite-image" },
};
const VIDEO_PAIR = {
  fast: {
    provider: "google",
    model: "veo-3.1-fast-generate-preview",
    resolution: "720p",
  },
  lite: {
    provider: "google",
    model: "veo-3.1-lite-generate-preview",
    resolution: "720p",
  },
} as const satisfies Record<string, RouteEntry>;

const other = (provider: ProviderId): ProviderId =>
  provider === "openai" ? "google" : "openai";

// The route Kiln proposes from the keys present, which runs nothing until the
// maker saves it. Each head is the maker's default for its kind (saving the
// proposal changes no model a task runs on first); behind it, the other
// provider's counterpart when that provider has a key. `fast` and `draft`
// lead with the provider of the maker's text and image defaults.
export function proposeRoutes(
  models: MakerModels,
  keys: Record<ProviderId, boolean>,
): MakerRoutes {
  const route = (
    kind: ModelKind,
    head: RouteEntry,
    behind: RouteEntry[],
    fallback: boolean,
  ): Route => {
    const list = [routeEntry(head, kind)];
    for (const entry of behind) {
      if (!keys[entry.provider] || list.some((m) => sameModel(m, entry))) {
        continue;
      }
      list.push(routeEntry(entry, kind));
    }
    return { models: list, fallback };
  };
  const text = models.text.provider;
  const image = models.image.provider;
  const videoHead = headOf(models, "video");
  return {
    deep: route("text", headOf(models, "text"), [DEEP[other(text)]], true),
    fast: route("text", FAST[text], [FAST[other(text)]], true),
    final: route(
      "image",
      headOf(models, "image"),
      [FINAL[other(image)]],
      false,
    ),
    draft: route("image", DRAFT[image], [DRAFT[other(image)]], false),
    video: route(
      "video",
      videoHead,
      [
        sameModel(videoHead, VIDEO_PAIR.lite)
          ? VIDEO_PAIR.fast
          : VIDEO_PAIR.lite,
      ],
      false,
    ),
  };
}

// The models a task may run on, in order, starting on the one it names (a
// card's own model): the rest of its role's route when the route falls back
// and holds that model; that model alone otherwise. A model the maker picked
// outside the route never falls back, and nothing outside it is ever added.
export function routeCandidates(
  route: Route | null | undefined,
  start: RouteEntry,
): RouteEntry[] {
  if (!route?.fallback) return [start];
  const at = route.models.findIndex((m) => sameModel(m, start));
  if (at < 0) return [start];
  return [start, ...route.models.filter((_, i) => i !== at)];
}

export type Failure =
  // Another model may pass; "provider" skips the failed provider's other models.
  | { move: "next" | "provider"; reason: string }
  | { move: "stop"; reason: string };

// A failure in a few words, for the record of a fallback.
export function failureWords(provider: ProviderId, error: unknown): string {
  const label = PROVIDER_LABELS[provider];
  const status = (error as { status?: unknown } | null)?.status;
  if (isOutOfCredit(error)) return `${label} is out of credit`;
  if (isKeyRejected(error)) return `${label} rejected the API key`;
  if (status === 429) return `${label} is rate-limiting`;
  if (typeof status === "number") return `${label} answered ${status}`;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "ProviderKeyMissing") return `${label} has no API key`;
  if (name === "CapabilityError") return `${label} cannot run this request`;
  return `${label} failed`;
}

// Whether a failure moves to the next model in the route. Only a failure the
// provider answered (nothing was generated, nothing charged) or one before the
// call went out may move. A call with no answer may have been charged: it
// stays final, counted at its estimate (Luis, 2026-10-29), so a frame is
// charged for one call at most and its worst case is the route's dearest
// model. The month's cap stops; so do a content refusal and a request no
// model would take.
export function fallbackAfter(
  provider: ProviderId,
  error: unknown,
  { callStarted }: { callStarted: boolean },
): Failure {
  const reason = failureWords(provider, error);
  const e = error as { name?: unknown; reason?: unknown } | null;
  if (e?.reason === "cap") return { move: "stop", reason: "this month's cap" };
  if (callStarted && !hadResponse(error)) {
    return {
      move: "stop",
      reason: `${PROVIDER_LABELS[provider]} did not answer`,
    };
  }
  if (
    e?.name === "ProviderKeyMissing" ||
    isKeyRejected(error) ||
    isOutOfCredit(error)
  ) {
    return { move: "provider", reason };
  }
  if (e?.name === "CapabilityError") return { move: "next", reason };
  if (!hadResponse(error)) return { move: "stop", reason };
  return classifyGenerationError(error) === "transient"
    ? { move: "next", reason }
    : { move: "stop", reason };
}

// The next model to try after `failed` failed this way, and the ones left
// behind it; null when none may run. Models skipped on the way (the failed
// provider's, after a key or credit failure; those that cannot run) are
// dropped.
export function pickNext(
  next: readonly RouteEntry[],
  failed: { provider: ProviderId },
  failure: Failure,
  runnable: (entry: RouteEntry) => boolean,
): { entry: RouteEntry; rest: RouteEntry[] } | null {
  if (failure.move === "stop") return null;
  for (let i = 0; i < next.length; i++) {
    const entry = next[i];
    if (failure.move === "provider" && entry.provider === failed.provider) {
      continue;
    }
    if (runnable(entry)) return { entry, rest: next.slice(i + 1) };
  }
  return null;
}

// The request one model would pay for, on another model of the route: the same
// prompt, references, aspect and length; only the model and what prices it
// change. A generation request does not depend on its provider.
export function routedRequest<T extends GenerationRequest>(
  request: T,
  entry: RouteEntry,
): T {
  const { quality: _q, resolution: _r, ...model } = request.model;
  return {
    ...request,
    model: {
      ...model,
      provider: entry.provider,
      model: entry.model,
      ...(entry.quality ? { quality: entry.quality } : {}),
      ...(entry.resolution ? { resolution: entry.resolution } : {}),
    },
  };
}

// Whether a model of the route can run this request: priced for it, and able
// to take its references (an image) or render its length (a video).
export function canRunRequest(
  entry: RouteEntry,
  request: GenerationRequest,
): boolean {
  if (request.kind === "video") {
    return estimateVideo(entry, request.durationSec) !== null;
  }
  const caps = PROVIDER_CAPABILITIES[entry.provider];
  if (!caps.edit || request.imageInputs.length > caps.maxRefs) return false;
  return estimateGeneration(entry, request.model.aspect) !== null;
}

// The most a request can cost along its route: one charged call at most, so
// the dearest model's max. null when a model has no price.
export function worstCase(
  request: GenerationRequest,
  candidates: readonly RouteEntry[],
): number | null {
  let worst = 0;
  for (const entry of candidates) {
    const routed = routedRequest(request, entry);
    const usd =
      routed.kind === "video"
        ? estimateVideo(routed.model, routed.durationSec)
        : (estimateGeneration(
            routed.model,
            routed.model.aspect,
            routed.imageInputs.length,
          )?.max ?? null);
    if (usd === null) return null;
    worst = Math.max(worst, usd);
  }
  return worst;
}

// What one take of a scene costs along its route, as Tune prices it: the
// typical of the model it starts on, the max of the dearest model it may run
// on (the queue reserves the same). null when its own model has no price.
// `route` holds only the models that may run here (keyed providers).
export function takeEstimate(
  model: RouteEntry & { aspect?: string },
  references: number,
  route: Route | null | undefined,
): { typical: number; max: number } | null {
  const own = estimateGeneration(model, model.aspect, references);
  if (!own) return null;
  let max = own.max;
  for (const entry of routeCandidates(route, model).slice(1)) {
    const caps = PROVIDER_CAPABILITIES[entry.provider];
    if (!caps.edit || references > caps.maxRefs) continue;
    const e = estimateGeneration(entry, model.aspect, references);
    if (e) max = Math.max(max, e.max);
  }
  return { typical: own.typical, max };
}

// What one video costs along its route: billed by the seconds rendered, so
// the dearest model's price at that length. null when its own model has none.
export function videoTakeEstimate(
  model: RouteEntry,
  seconds: number,
  route: Route | null | undefined,
): number | null {
  const own = estimateVideo(model, seconds);
  if (own === null) return null;
  let max = own;
  for (const entry of routeCandidates(route, model).slice(1)) {
    const usd = estimateVideo(entry, seconds);
    if (usd !== null) max = Math.max(max, usd);
  }
  return max;
}

// The routes a new take is priced along (the scenes', the video's), each with
// only the models that may run here; null where no route was saved.
export interface TakeRoutes {
  final: Route | null;
  video: Route | null;
}

export const NO_TAKE_ROUTES: TakeRoutes = { final: null, video: null };

// What a job carries of its route: the models it may still move to, fixed when
// the maker approved the estimate, and each move it made.
export const RouteSwitch = z.object({
  from: RouteEntry,
  to: RouteEntry,
  reason: z.string(),
  at: z.string(),
});
export type RouteSwitch = z.infer<typeof RouteSwitch>;

export const JobRoute = z.object({
  next: z.array(RouteEntry).default([]),
  switched: z.array(RouteSwitch).default([]),
});
export type JobRoute = z.infer<typeof JobRoute>;

export function readJobRoute(raw: unknown): JobRoute {
  const parsed = JobRoute.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { next: [], switched: [] };
}

// What a take shows of its route: the model it ran on and, after a move, the
// first model it left and why.
export function ranOn(route: JobRoute): RanOn | undefined {
  const first = route.switched[0];
  const last = route.switched.at(-1);
  if (!first || !last) return undefined;
  return {
    label: modelLabel(last.to),
    from: modelLabel(first.from),
    reason: first.reason,
  };
}

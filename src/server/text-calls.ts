import type { BrandProfile } from "@/domain/brand";
import type { DestinationText } from "@/domain/destination";
import {
  TEXT_CALL_BUDGETS,
  type TextCallKind,
  textEstimate,
} from "@/domain/generation-cost";
import type { ListingText } from "@/domain/listing";
import {
  assertModel,
  catalogFor,
  DEFAULT_MAKER_MODELS,
  modelLabel,
  type ProviderId,
} from "@/domain/model-defaults";
import {
  fallbackAfter,
  pickNext,
  type RanOn,
  type RouteEntry,
  roleRoute,
  routeCandidates,
  TEXT_CALL_ROLES,
} from "@/domain/model-routing";
import type { Product } from "@/domain/product";
import { describeProviderError, errorMessage } from "@/domain/queue";
import type { Recipe } from "@/domain/recipe";
import { SEED_BRAND } from "@/domain/seed";
import {
  type BaseUnderstanding,
  neutralUnderstanding,
} from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import type { TextResult } from "@/providers/interfaces";
import { hasProviderKey } from "@/providers/keys";
import { fallbackVariants } from "@/providers/mock/art-director";
import { providerMode } from "@/providers/mode";
import { getArtDirector, getVisionProvider } from "@/providers/registry";
import type {
  ListingCopy,
  ProductDraft,
  ProductReview,
  ReviewField,
} from "@/providers/text-prompts";
import { textCall, withDirectSpend } from "@/server/direct-spend";
import { getMakerModelSetup } from "@/server/maker-repository";

// Vision, the art director and the product and listing text, on their role's
// route (TEXT_CALL_ROLES), under the monthly cap like every paid call. A
// failure another model can fix moves down the route the maker saved, each
// attempt reserved and recorded on its own; the answer then says which model
// answered and why (`ranOn`). When the route fails, the flow is never blocked:
// the answer says it degraded (the neutral understanding, the recipe's own
// directions), why, and which other provider the maker may ask instead, with
// its price — only on a click. A model the maker asks for by name runs alone.

export interface TextModel {
  provider: ProviderId;
  model: string;
}

export interface Degraded {
  provider: ProviderId;
  model: string;
  label: string;
  message: string;
  // The other provider's text model, to offer (never run on its own); null
  // when switching would not help (the month's cap) or it was tried.
  alternative: (TextModel & { label: string; usd: number | null }) | null;
}

function degraded(
  model: TextModel,
  kind: TextCallKind,
  error: unknown,
  tried: readonly TextModel[],
): Degraded {
  const cap = (error as { reason?: unknown } | null)?.reason === "cap";
  const other = catalogFor("text").find(
    (m) => !tried.some((t) => t.provider === m.provider),
  );
  return {
    ...model,
    label: modelLabel(model),
    message: describeProviderError(model.provider, error),
    alternative:
      cap || !other
        ? null
        : {
            provider: other.provider,
            model: other.id,
            label: other.label,
            usd: textEstimate(
              { provider: other.provider, model: other.id },
              TEXT_CALL_BUDGETS[kind],
            ),
          },
  };
}

class RouteFailed extends Error {
  constructor(
    readonly last: TextModel,
    readonly tried: TextModel[],
    readonly cause: unknown,
  ) {
    super(errorMessage(cause));
    this.name = "RouteFailed";
  }
}

// The models a call may run on: the one asked for by name alone, else its
// role's route (the default text model alone until the maker saves routes).
export async function textCandidates(
  kind: TextCallKind,
  asked?: TextModel,
): Promise<RouteEntry[]> {
  if (asked) return [{ provider: asked.provider, model: asked.model }];
  const { models, routes } = await getMakerModelSetup();
  const route = roleRoute(routes, TEXT_CALL_ROLES[kind]);
  return routeCandidates(route, route?.models[0] ?? models.text);
}

// Whether a model of the route may take a call of this kind now: a pinned
// price, and its key in a live run.
export const textRunnable = (kind: TextCallKind) => (entry: RouteEntry) =>
  textEstimate(entry, TEXT_CALL_BUDGETS[kind]) !== null &&
  (providerMode() === "mock" || hasProviderKey(entry.provider));

// Run one text call along its candidates. Each attempt is its own direct call
// against the cap (reserved first, its row naming its model and the move that
// led to it); a failure moves on only as fallbackAfter allows.
async function runText<T>(
  kind: TextCallKind,
  asked: TextModel | undefined,
  call: (
    model: TextModel,
    beforeCall: () => Promise<void>,
  ) => Promise<TextResult<T>>,
  projectId?: string,
): Promise<{ value: T; label: string; ranOn?: RanOn }> {
  const candidates = await textCandidates(kind, asked);
  let [current] = candidates;
  let rest = candidates.slice(1);
  const tried: TextModel[] = [];
  let first: { from: TextModel; reason: string } | undefined;
  let move: { from: RouteEntry; reason: string } | undefined;
  for (;;) {
    tried.push(current);
    let callStarted = false;
    const model = current;
    try {
      assertModel(model, "text");
      const result = await withDirectSpend(
        {
          ...textCall<T>(model, kind),
          ...(projectId ? { projectId } : {}),
          ...(move
            ? {
                route: {
                  next: [],
                  switched: [
                    {
                      from: move.from,
                      to: model,
                      reason: move.reason,
                      at: new Date().toISOString(),
                    },
                  ],
                },
              }
            : {}),
        },
        (beforeCall) =>
          call(model, async () => {
            await beforeCall();
            callStarted = true;
          }),
      );
      return {
        value: result.value,
        label: modelLabel(model),
        ...(first
          ? {
              ranOn: {
                label: modelLabel(model),
                from: modelLabel(first.from),
                reason: first.reason,
              },
            }
          : {}),
      };
    } catch (error) {
      const failure = fallbackAfter(model.provider, error, { callStarted });
      const picked = pickNext(rest, model, failure, textRunnable(kind));
      if (!picked) throw new RouteFailed(model, tried, error);
      console.warn(
        `[kiln] ${kind} moved from ${model.model} to ${picked.entry.model}: ${failure.reason}`,
      );
      first ??= { from: model, reason: failure.reason };
      move = { from: model, reason: failure.reason };
      current = picked.entry;
      rest = picked.rest;
    }
  }
}

function routeDegraded(
  error: unknown,
  kind: TextCallKind,
  asked: TextModel | undefined,
): Degraded {
  if (error instanceof RouteFailed) {
    return degraded(error.last, kind, error.cause, error.tried);
  }
  const model = asked ?? DEFAULT_MAKER_MODELS.text;
  return degraded(model, kind, error, [model]);
}

export async function readProduct(
  assetUrl: string,
  model?: TextModel,
): Promise<{
  understanding: BaseUnderstanding;
  degraded?: Degraded;
  ranOn?: RanOn;
}> {
  try {
    const { value, ranOn } = await runText<BaseUnderstanding>(
      "vision",
      model,
      (m, beforeCall) =>
        getVisionProvider(m.provider).analyze(
          { assetUrl },
          { model: m.model, beforeCall },
        ),
    );
    return { understanding: value, ...(ranOn ? { ranOn } : {}) };
  } catch (error) {
    console.warn("[kiln] vision degraded:", errorMessage(error));
    return {
      understanding: neutralUnderstanding(SEED_BRAND.palette),
      degraded: routeDegraded(error, "vision", model),
    };
  }
}

export async function directScenes(
  input: {
    understanding: BaseUnderstanding;
    recipe: Recipe;
    brand: BrandProfile;
    n: number;
  },
  model?: TextModel,
): Promise<{
  variants: VariantDirection[];
  degraded?: Degraded;
  ranOn?: RanOn;
}> {
  try {
    const { value, ranOn } = await runText<VariantDirection[]>(
      "artDirection",
      model,
      (m, beforeCall) =>
        getArtDirector(m.provider).proposeDirections(input, {
          model: m.model,
          beforeCall,
        }),
    );
    return { variants: value, ...(ranOn ? { ranOn } : {}) };
  } catch (error) {
    console.warn("[kiln] art direction degraded:", errorMessage(error));
    return {
      variants: fallbackVariants(input.recipe, input.understanding, input.n),
      degraded: routeDegraded(error, "artDirection", model),
    };
  }
}

// The product form's "Fill from the photo": a draft the maker reviews, never
// saved on its own. Hex colours the model got wrong are dropped. On failure the
// form stays as it was and the answer says why.
export async function draftProduct(
  assetUrl: string,
  model?: TextModel,
): Promise<{ draft?: ProductDraft; degraded?: Degraded; ranOn?: RanOn }> {
  try {
    const { value: draft, ranOn } = await runText<ProductDraft>(
      "productDraft",
      model,
      (m, beforeCall) =>
        getVisionProvider(m.provider).draftProduct(
          { assetUrl },
          { model: m.model, beforeCall },
        ),
    );
    return {
      draft: {
        ...draft,
        colours: draft.colours
          .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex))
          .slice(0, 4),
        wording: draft.wording.slice(0, 3),
      },
      ...(ranOn ? { ranOn } : {}),
    };
  } catch (error) {
    console.warn("[kiln] product draft degraded:", errorMessage(error));
    return { degraded: routeDegraded(error, "productDraft", model) };
  }
}

// A listing's prose written by the text model (the board's "Write it with the
// text model"), under the cap. Tags come back trimmed, blanks dropped; nothing
// is cut to fit — the board checks the answer against the channel's rules and
// shows what to fix. On failure the listing stays as it was and the answer
// says why.
export async function writeListing(
  input: {
    channel: string;
    product: Product;
    rules: DestinationText;
    draft: ListingText;
  },
  model?: TextModel,
  // The project the listing is for: the call's cost counts there.
  projectId?: string,
): Promise<{ copy?: ListingCopy; degraded?: Degraded; ranOn?: RanOn }> {
  try {
    const { value, ranOn } = await runText<ListingCopy>(
      "listingCopy",
      model,
      (m, beforeCall) =>
        getArtDirector(m.provider).writeListing(input, {
          model: m.model,
          beforeCall,
        }),
      projectId,
    );
    const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);
    return {
      copy: {
        title: value.title.trim(),
        description: value.description.trim(),
        tags: clean(value.tags),
        materials: clean(value.materials),
      },
      ...(ranOn ? { ranOn } : {}),
    };
  } catch (error) {
    console.warn("[kiln] listing copy degraded:", errorMessage(error));
    return { degraded: routeDegraded(error, "listingCopy", model) };
  }
}

// The product form's "Review with AI": suggestions and checks on the form as
// typed, under the cap, on the fast route. Nothing is applied here
// (cleanReview keeps what the form can take, the maker accepts each). On
// failure the form stays as it was and the answer says why.
export async function reviewProduct(
  fields: ReviewField[],
  model?: TextModel,
): Promise<{
  review?: ProductReview;
  // The model that answered.
  label?: string;
  degraded?: Degraded;
  ranOn?: RanOn;
}> {
  try {
    const { value, label, ranOn } = await runText<ProductReview>(
      "productReview",
      model,
      (m, beforeCall) =>
        getArtDirector(m.provider).reviewProduct(
          { fields },
          { model: m.model, beforeCall },
        ),
    );
    return { review: value, label, ...(ranOn ? { ranOn } : {}) };
  } catch (error) {
    console.warn("[kiln] product review degraded:", errorMessage(error));
    return { degraded: routeDegraded(error, "productReview", model) };
  }
}

// What a text call of this kind would run on and cost, before asking: its
// route's models that may run (the first always), what the first costs, and
// the most it can cost, one charged call at most, so the dearest model's.
// Null prices when a model has none pinned.
export async function textRoute(kind: TextCallKind): Promise<{
  labels: string[];
  typical: number | null;
  max: number | null;
}> {
  const candidates = (await textCandidates(kind)).filter(
    (c, i) => i === 0 || textRunnable(kind)(c),
  );
  let worst: number | null = null;
  for (const entry of candidates) {
    const usd = textEstimate(entry, TEXT_CALL_BUDGETS[kind]);
    if (usd === null) {
      worst = null;
      break;
    }
    worst = Math.max(worst ?? 0, usd);
  }
  return {
    labels: candidates.map(modelLabel),
    typical: textEstimate(candidates[0], TEXT_CALL_BUDGETS[kind]),
    max: worst,
  };
}

// The most a text call of this kind can cost along its route (the price
// shown before asking).
export async function textWorstCase(
  kind: TextCallKind,
): Promise<number | null> {
  return (await textRoute(kind)).max;
}

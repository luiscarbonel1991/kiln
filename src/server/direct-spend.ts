import { DEFAULT_EFFORT, type Effort } from "@/domain/effort";
import {
  costFromUsage,
  estimateGeneration,
  estimateVideo,
  type TextCallKind,
  textBudget,
  textEstimate,
  toMicros,
  videoCost,
} from "@/domain/generation-cost";
import {
  type ImageQuality,
  modelLabel,
  PROVIDER_LABELS,
  ProviderId,
  type VideoResolution,
} from "@/domain/model-defaults";
import type { JobRoute } from "@/domain/model-routing";
import { describeProviderError, hadResponse } from "@/domain/queue";
import { hasDatabase } from "@/lib/db";
import type { TextResult } from "@/providers/interfaces";
import { providerMode } from "@/providers/mode";
import type { GenerationResult } from "@/providers/types";
import {
  closeDirectCall,
  markDirectCall,
  readUnlisted,
  reserveDirectCall,
} from "@/server/generation-repository";
import type { MakerRef } from "@/server/maker-repository";

// The monthly cap covers every paid call made from Kiln, not only the queue.
// Mock runs neither reserve nor count. Without a database (tests) both are
// no-ops.

// What a direct call's cost counts for: the project it works for, and the
// chat conversation whose paid tool made it.
export interface SpendFor {
  projectId?: string;
  sessionId?: string;
}

// What a direct call may cost, and how to measure what it did cost.
export interface PricedCall<T extends { usage?: unknown }> extends SpendFor {
  // The move along its route that led to this call, kept on its row.
  route?: JobRoute;
  provider: string;
  model: string;
  // The most the call can cost; null when the model has no pinned price.
  estimateMax: number | null;
  costOf(result: T): number | null;
}

// `model` is the one the adapter will run (already resolved), so an id the
// adapter would swap for its default is never priced at $0.
export function imageCall(
  model: { provider: string; model: string; quality?: ImageQuality },
  aspect: string,
  references = 0,
): PricedCall<GenerationResult> {
  return {
    provider: model.provider,
    model: model.model,
    estimateMax: estimateGeneration(model, aspect, references)?.max ?? null,
    costOf: (result) =>
      result.usage
        ? costFromUsage(
            { provider: result.provider, model: result.model },
            result.usage,
          )
        : null,
  };
}

// Video is priced by the second rendered; a clip whose provider reports its
// usage (Gemini Omni) is costed from it. A length the model does not render
// has no estimate, so it never runs.
export function videoCall(
  model: { provider: string; model: string; resolution?: VideoResolution },
  durationSec: number,
): PricedCall<GenerationResult> {
  return {
    provider: model.provider,
    model: model.model,
    estimateMax: estimateVideo(model, durationSec),
    costOf: (result) => {
      const ran = {
        provider: result.provider,
        model: result.model,
        resolution: model.resolution,
      };
      return (
        (result.usage ? costFromUsage(ran, result.usage) : null) ??
        videoCost(ran, durationSec)
      );
    },
  };
}

// A text call (vision, art direction): bounded by its budget at its effort,
// measured from the usage it reports.
export function textCall<T>(
  model: { provider: string; model: string },
  kind: TextCallKind,
  effort: Effort = DEFAULT_EFFORT,
): PricedCall<TextResult<T>> {
  return {
    provider: model.provider,
    model: model.model,
    estimateMax: textEstimate(model, textBudget(kind, model, effort)),
    costOf: (result) =>
      result.usage ? costFromUsage(model, result.usage) : null,
  };
}

// One direct call against the cap, opened before its request and closed
// once with what it did: `beforeCall` right before the paid request, then
// `done` with its result or `failed` with its error. A streamed call (the
// chat) closes when its stream ends. Mock runs and runs without a database
// reserve and record nothing.
export interface DirectCall<T> {
  beforeCall(): Promise<void>;
  done(result: T): Promise<void>;
  failed(error: unknown): Promise<void>;
}

const UNCOUNTED: DirectCall<never> = {
  beforeCall: async () => {},
  done: async () => {},
  failed: async () => {},
};

// The estimated max is reserved first, under the maker lock, so parallel
// calls cannot pass the cap together; the row then carries the measured cost.
// An error the provider answered counts nothing, a call with no answer counts
// at its estimate, and a call never made (a stub) records nothing. A model its
// provider's last key check no longer lists is refused before anything, as a
// model that cannot run (a route moves past it).
export async function openDirectCall<T extends { usage?: unknown }>(
  maker: MakerRef,
  priced: PricedCall<T>,
): Promise<DirectCall<T>> {
  if (!hasDatabase() || providerMode() === "mock") return UNCOUNTED;
  if (priced.estimateMax === null) {
    throw new Error(
      `No pinned price for ${priced.model}, so it cannot run under the cap.`,
    );
  }
  const provider = ProviderId.safeParse(priced.provider);
  if (provider.success) {
    const gone = (await readUnlisted(maker.id))[provider.data];
    if (gone?.models.includes(priced.model)) {
      const model = { provider: provider.data, model: priced.model };
      throw Object.assign(
        new Error(
          `${PROVIDER_LABELS[provider.data]} no longer offers ${modelLabel(model)} (its model list, checked ${gone.at.slice(0, 10)}) — pick another model.`,
        ),
        { name: "CapabilityError" },
      );
    }
  }
  const id = await reserveDirectCall({
    makerId: maker.id,
    provider: priced.provider,
    model: priced.model,
    estimateMicros: toMicros(priced.estimateMax),
    ...(priced.projectId ? { projectId: priced.projectId } : {}),
    ...(priced.sessionId ? { sessionId: priced.sessionId } : {}),
    ...(priced.route ? { route: priced.route } : {}),
    memberId: maker.member?.id ?? null,
  });
  let callStarted = false;
  let closed = false;
  return {
    async beforeCall() {
      await markDirectCall(id);
      callStarted = true;
    },
    async done(result) {
      if (closed) return;
      closed = true;
      const usd = callStarted ? priced.costOf(result) : null;
      await closeDirectCall(id, {
        usage: result.usage,
        actualMicros: usd === null ? null : toMicros(usd),
      }).catch((e) => console.warn("[kiln spend] could not record a call", e));
    },
    async failed(error) {
      if (closed) return;
      closed = true;
      await closeDirectCall(id, {
        error:
          priced.provider === "google" || priced.provider === "openai"
            ? describeProviderError(priced.provider, error)
            : String(error),
        mayBeCharged: callStarted && !hadResponse(error),
      }).catch((e) => console.warn("[kiln spend] could not close a call", e));
    },
  };
}

// Run one direct (studio) call against the cap (openDirectCall).
export async function withDirectSpend<T extends { usage?: unknown }>(
  maker: MakerRef,
  priced: PricedCall<T>,
  call: (beforeCall: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const direct = await openDirectCall(maker, priced);
  let result: T;
  try {
    result = await call(() => direct.beforeCall());
  } catch (error) {
    await direct.failed(error);
    throw error;
  }
  await direct.done(result);
  return result;
}

import {
  costFromUsage,
  estimateGeneration,
  estimateVideo,
  TEXT_CALL_BUDGETS,
  type TextCallKind,
  textEstimate,
  toMicros,
  videoCost,
} from "@/domain/generation-cost";
import type { ImageQuality, VideoResolution } from "@/domain/model-defaults";
import { describeProviderError, hadResponse } from "@/domain/queue";
import { hasDatabase } from "@/lib/db";
import type { TextResult } from "@/providers/interfaces";
import { providerMode } from "@/providers/mode";
import type { GenerationResult } from "@/providers/types";
import {
  closeDirectCall,
  markDirectCall,
  reserveDirectCall,
} from "@/server/generation-repository";
import { getCurrentMaker } from "@/server/maker-repository";

// The monthly cap covers every paid call made from Kiln, not only the queue.
// Mock runs neither reserve nor count. Without a database (tests) both are
// no-ops.

// What a direct call may cost, and how to measure what it did cost.
export interface PricedCall<T extends { usage?: unknown }> {
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
): PricedCall<GenerationResult> {
  return {
    provider: model.provider,
    model: model.model,
    estimateMax: estimateGeneration(model, aspect)?.max ?? null,
    costOf: (result) =>
      result.usage
        ? costFromUsage(
            { provider: result.provider, model: result.model },
            result.usage,
          )
        : null,
  };
}

// Video bills the seconds rendered, so a finished video costs its estimate. A
// length the model does not render has no estimate, so it never runs.
export function videoCall(
  model: { provider: string; model: string; resolution?: VideoResolution },
  durationSec: number,
): PricedCall<GenerationResult> {
  return {
    provider: model.provider,
    model: model.model,
    estimateMax: estimateVideo(model, durationSec),
    costOf: (result) =>
      videoCost(
        {
          provider: result.provider,
          model: result.model,
          resolution: model.resolution,
        },
        durationSec,
      ),
  };
}

// A text call (vision, art direction): bounded by its budget, measured from
// the usage it reports.
export function textCall<T>(
  model: { provider: string; model: string },
  kind: TextCallKind,
): PricedCall<TextResult<T>> {
  return {
    provider: model.provider,
    model: model.model,
    estimateMax: textEstimate(model, TEXT_CALL_BUDGETS[kind]),
    costOf: (result) =>
      result.usage ? costFromUsage(model, result.usage) : null,
  };
}

// Run one direct (studio) call against the cap. Its estimated max is reserved
// first, under the maker lock, so parallel calls cannot pass the cap together;
// the row then carries the measured cost. The provider marks the row right
// before its paid request (`beforeCall`): an error it answered counts nothing,
// a call with no answer counts at its estimate, and a call never made (a stub)
// records nothing.
export async function withDirectSpend<T extends { usage?: unknown }>(
  priced: PricedCall<T>,
  call: (beforeCall: () => Promise<void>) => Promise<T>,
): Promise<T> {
  if (!hasDatabase() || providerMode() === "mock") {
    return call(async () => {});
  }
  if (priced.estimateMax === null) {
    throw new Error(
      `No pinned price for ${priced.model}, so it cannot run under the cap.`,
    );
  }
  const maker = await getCurrentMaker();
  const id = await reserveDirectCall({
    makerId: maker.id,
    provider: priced.provider,
    model: priced.model,
    estimateMicros: toMicros(priced.estimateMax),
  });
  let callStarted = false;
  let result: T;
  try {
    result = await call(async () => {
      await markDirectCall(id);
      callStarted = true;
    });
  } catch (error) {
    await closeDirectCall(id, {
      error:
        priced.provider === "google" || priced.provider === "openai"
          ? describeProviderError(priced.provider, error)
          : String(error),
      mayBeCharged: callStarted && !hadResponse(error),
    }).catch((e) => console.warn("[kiln spend] could not close a call", e));
    throw error;
  }
  const usd = callStarted ? priced.costOf(result) : null;
  await closeDirectCall(id, {
    usage: result.usage,
    actualMicros: usd === null ? null : toMicros(usd),
  }).catch((e) => console.warn("[kiln spend] could not record a call", e));
  return result;
}

import {
  costFromUsage,
  estimateGeneration,
  estimateVideo,
  soraSeconds,
  toMicros,
  videoCost,
} from "@/domain/generation-cost";
import { errorMessage, hadResponse } from "@/domain/queue";
import { env } from "@/lib/env";
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
export interface PricedCall {
  model: string;
  // The most the call can cost; null when the model has no pinned price.
  estimateMax: number | null;
  costOf(result: GenerationResult): number | null;
}

// `model` is the one the adapter will run (already resolved), so an id the
// adapter would swap for its default is never priced at $0.
export function imageCall(
  model: { provider: string; model: string },
  aspect: string,
): PricedCall {
  return {
    model: model.model,
    estimateMax: estimateGeneration(model, aspect)?.max ?? null,
    costOf: (result) =>
      result.usage ? costFromUsage(result.model, result.usage) : null,
  };
}

// Sora bills the seconds generated, so a finished video costs its estimate.
export function videoCall(
  model: { provider: string; model: string },
  durationSec: number,
): PricedCall {
  const seconds = soraSeconds(durationSec);
  return {
    model: model.model,
    estimateMax: estimateVideo(model, durationSec),
    costOf: (result) => videoCost(result.model, seconds),
  };
}

// Run one direct (studio) call against the cap. Its estimated max is reserved
// first, under the maker lock, so parallel calls cannot pass the cap together;
// the row then carries the measured cost. The provider marks the row right
// before its paid request (`beforeCall`): an error it answered counts nothing,
// a call with no answer counts at its estimate, and a call never made (a stub)
// records nothing.
export async function withDirectSpend(
  priced: PricedCall,
  call: (beforeCall: () => Promise<void>) => Promise<GenerationResult>,
): Promise<GenerationResult> {
  if (!env.DATABASE_URL || providerMode() === "mock") {
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
    model: priced.model,
    estimateMicros: toMicros(priced.estimateMax),
  });
  let callStarted = false;
  let result: GenerationResult;
  try {
    result = await call(async () => {
      await markDirectCall(id);
      callStarted = true;
    });
  } catch (error) {
    await closeDirectCall(id, {
      error: errorMessage(error),
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

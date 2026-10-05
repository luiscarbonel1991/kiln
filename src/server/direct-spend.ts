import {
  costFromUsage,
  estimateGeneration,
  fromMicros,
  toMicros,
} from "@/domain/generation-cost";
import { errorMessage, hadResponse } from "@/domain/queue";
import { env } from "@/lib/env";
import { providerMode } from "@/providers/mode";
import type { GenerationResult } from "@/providers/types";
import {
  budget,
  closeDirectCall,
  markDirectCall,
  reserveDirectCall,
} from "@/server/generation-repository";
import { getCurrentMaker } from "@/server/maker-repository";

// The monthly cap covers every paid call made from Kiln, not only the queue.
// Mock runs neither reserve nor count. Without a database (tests) both are
// no-ops.

// Run one direct (studio) image call against the cap. Its estimated max is
// reserved first, under the maker lock, so parallel calls cannot pass the cap
// together; the row then carries the measured cost. The provider marks the
// row right before its paid request (`beforeCall`): an error it answered
// counts nothing, a call with no answer counts at its estimate.
export async function withDirectSpend(
  model: { provider: string; model: string },
  aspect: string,
  call: (beforeCall: () => Promise<void>) => Promise<GenerationResult>,
): Promise<GenerationResult> {
  if (!env.DATABASE_URL || providerMode() === "mock") {
    return call(async () => {});
  }
  const maker = await getCurrentMaker();
  const estimate = estimateGeneration(model, aspect);
  const id = await reserveDirectCall({
    makerId: maker.id,
    model: model.model,
    estimateMicros: toMicros(estimate?.max ?? 0),
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
  const usd = result.usage ? costFromUsage(result.model, result.usage) : null;
  await closeDirectCall(id, {
    usage: result.usage,
    actualMicros: usd === null ? null : toMicros(usd),
  }).catch((e) => console.warn("[kiln spend] could not record a call", e));
  return result;
}

// For calls without a pinned price (video): refuse once the month's spend and
// what is reserved reach the cap.
export async function assertUnderCap(): Promise<void> {
  if (!env.DATABASE_URL || providerMode() === "mock") return;
  const maker = await getCurrentMaker();
  const b = await budget(maker.id);
  if (b.spentMicros + b.reservedMicros >= b.capMicros) {
    throw new Error(
      `This month's spending cap ($${fromMicros(b.capMicros).toFixed(2)}) was reached.`,
    );
  }
}

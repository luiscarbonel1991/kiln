import {
  costFromUsage,
  estimateGeneration,
  fromMicros,
  toMicros,
} from "@/domain/generation-cost";
import { env } from "@/lib/env";
import { providerMode } from "@/providers/mode";
import type { GenerationResult } from "@/providers/types";
import { budget, recordDirectSpend } from "@/server/generation-repository";
import { getCurrentMaker } from "@/server/maker-repository";

// The monthly cap covers every paid call made from Kiln, not only the queue:
// the studio's direct generations check it before calling and record what they
// cost after. Mock runs neither check nor count. Without a database (tests)
// both are no-ops.

export async function assertUnderCap(): Promise<void> {
  if (!env.DATABASE_URL || providerMode() === "mock") return;
  const maker = await getCurrentMaker();
  const b = await budget(maker.id);
  if (b.spentMicros >= b.capMicros) {
    throw new Error(
      `This month's spending cap ($${fromMicros(b.capMicros).toFixed(2)}) was reached.`,
    );
  }
}

// Never fails the caller: the generation already happened (and was paid).
export async function recordDirectGeneration(
  result: GenerationResult,
  aspect: string,
): Promise<void> {
  if (!env.DATABASE_URL || providerMode() === "mock") return;
  try {
    const maker = await getCurrentMaker();
    const usd = result.usage ? costFromUsage(result.model, result.usage) : null;
    const estimate = estimateGeneration(
      { provider: result.provider, model: result.model },
      aspect,
    );
    await recordDirectSpend({
      makerId: maker.id,
      mode: providerMode(),
      model: result.model,
      usage: result.usage,
      actualMicros: usd === null ? null : toMicros(usd),
      estimateMicros: toMicros(estimate?.max ?? 0),
    });
  } catch (error) {
    console.warn("[kiln spend] could not record a direct generation", error);
  }
}

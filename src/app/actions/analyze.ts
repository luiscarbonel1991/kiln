"use server";

import { z } from "zod";
import { defaultTextModel, ProviderId } from "@/domain/model-defaults";
import type { BaseUnderstanding } from "@/domain/understanding";
import { type Degraded, readProduct } from "@/server/text-calls";

const AnalyzeInput = z.object({
  assetUrl: z.string().min(1, "Missing master asset URL."),
  // Another text model the maker chose (the degraded notice's offer).
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// Server Function: the only client path into @/providers for vision. The Zod
// guard is the trust boundary (Server Functions are POST-reachable). Runs on
// the maker's text model unless another is named; a failure comes back as the
// neutral understanding with why it degraded and the other provider to offer.
export async function analyzeMaster(input: {
  assetUrl: string;
  model?: { provider: ProviderId; model: string };
}): Promise<{ understanding: BaseUnderstanding; degraded?: Degraded }> {
  const safe = AnalyzeInput.parse(input);
  return readProduct(safe.assetUrl, safe.model ?? defaultTextModel());
}

"use server";

import { z } from "zod";
import { BaseUnderstanding } from "@/domain/understanding";
import { getVisionProvider } from "@/providers/registry";

const AnalyzeInput = z.object({
  assetUrl: z.string().min(1, "Missing master asset URL."),
});

// Server Function: the only client path into @/providers for vision. The Zod
// guard is the trust boundary (Server Functions are POST-reachable). Provider
// defaults to google (mock today; see registry TODO).
export async function analyzeMaster(input: {
  assetUrl: string;
}): Promise<BaseUnderstanding> {
  const safe = AnalyzeInput.parse(input);
  const result = await getVisionProvider("google").analyze(safe);
  return BaseUnderstanding.parse(result);
}

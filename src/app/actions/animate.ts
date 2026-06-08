"use server";

import { getVideoProvider } from "@/providers/registry";
import { AnimateInput, GenerationResult } from "@/providers/types";

// Server Function: the only client path into @/providers for video. Video is
// single-provider (google/Veo) this pass — getVideoProvider returns undefined
// for any provider without a video adapter, so we guard. Mirrors edit.ts; the
// Zod parse is the trust boundary.
export async function animateVideo(
  input: AnimateInput,
): Promise<GenerationResult> {
  const safe = AnimateInput.parse(input);
  const provider = getVideoProvider("google");
  if (!provider) throw new Error("No video provider available");
  const result = await provider.animate(safe);
  return GenerationResult.parse(result);
}

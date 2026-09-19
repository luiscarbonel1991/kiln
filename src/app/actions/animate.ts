"use server";

import { getVideoProvider } from "@/providers/registry";
import { AnimateInput, GenerationResult } from "@/providers/types";

// Server Function: the only client path into @/providers for video. The provider
// resolves from the card's model (Veo on google, Sora on openai); the guard stays
// for any id without a video adapter. Mirrors edit.ts; Zod is the trust boundary.
export async function animateVideo(
  input: AnimateInput,
): Promise<GenerationResult> {
  const safe = AnimateInput.parse(input);
  const provider = getVideoProvider(safe.model.provider);
  if (!provider) throw new Error("No video provider available");
  const result = await provider.animate(safe);
  return GenerationResult.parse(result);
}

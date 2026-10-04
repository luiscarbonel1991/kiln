"use server";

import { generationModel } from "@/domain/model-defaults";
import { getVideoProvider } from "@/providers/registry";
import { AnimateInput, GenerationResult } from "@/providers/types";
import { assertUnderCap } from "@/server/direct-spend";

// Server Function: the only client path into @/providers for video. The provider
// comes from the card's model under the generation policy (OpenAI only: Sora);
// the guard stays for any id without a video adapter. Mirrors edit.ts; Zod is
// the trust boundary.
export async function animateVideo(
  input: AnimateInput,
): Promise<GenerationResult> {
  const parsed = AnimateInput.parse(input);
  const safe = { ...parsed, model: generationModel(parsed.model, "video") };
  // Video respects the cap; its cost is not recorded yet (no pinned Sora price).
  await assertUnderCap();
  const provider = getVideoProvider(safe.model.provider);
  if (!provider) throw new Error("No video provider available");
  const result = await provider.animate(safe);
  return GenerationResult.parse(result);
}

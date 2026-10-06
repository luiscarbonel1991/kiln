"use server";

import { generationModel } from "@/domain/model-defaults";
import { resolveVideoModel } from "@/providers/models";
import { getVideoProvider } from "@/providers/registry";
import { AnimateInput, GenerationResult } from "@/providers/types";
import { videoCall, withDirectSpend } from "@/server/direct-spend";

// Server Function: the only client path into @/providers for video. The provider
// comes from the card's model under the generation policy (OpenAI only: Sora);
// the guard stays for any id without a video adapter. Mirrors edit.ts; Zod is
// the trust boundary. The video reserves its pinned max against the monthly cap
// and records what it cost, like the image calls; the model is resolved first,
// so the price and the call are for the same model.
export async function animateVideo(
  input: AnimateInput,
): Promise<GenerationResult> {
  const parsed = AnimateInput.parse(input);
  const model = generationModel(parsed.model, "video");
  const provider = getVideoProvider(model.provider);
  if (!provider) throw new Error("No video provider available");
  const safe = {
    ...parsed,
    model: { ...model, model: resolveVideoModel(model.provider, model.model) },
  };
  return withDirectSpend(
    videoCall(safe.model, safe.durationSec),
    async (beforeCall) =>
      GenerationResult.parse(await provider.animate(safe, { beforeCall })),
  );
}

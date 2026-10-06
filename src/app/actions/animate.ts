"use server";

import { assertModel, PROVIDER_LABELS } from "@/domain/model-defaults";
import { getVideoProvider } from "@/providers/registry";
import { AnimateInput, GenerationResult } from "@/providers/types";
import { videoCall, withDirectSpend } from "@/server/direct-spend";

// Server Function: the only client path into @/providers for video. The
// provider is the card's own; a retired or unknown model (Sora) is refused with
// the reason, never swapped. Mirrors edit.ts; Zod is the trust boundary. The
// video reserves its pinned max against the monthly cap and records what it
// cost, like the image calls.
export async function animateVideo(
  input: AnimateInput,
): Promise<GenerationResult> {
  const parsed = AnimateInput.parse(input);
  assertModel(parsed.model, "video");
  const provider = getVideoProvider(parsed.model.provider);
  if (!provider) {
    throw new Error(
      `${PROVIDER_LABELS[parsed.model.provider]} has no video model.`,
    );
  }
  return withDirectSpend(
    videoCall(parsed.model, parsed.durationSec),
    async (beforeCall) =>
      GenerationResult.parse(await provider.animate(parsed, { beforeCall })),
  );
}

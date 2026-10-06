"use server";

import { assertModel, PROVIDER_LABELS } from "@/domain/model-defaults";
import { snapSeconds, videoSecondsFor } from "@/domain/video";
import { getVideoProvider } from "@/providers/registry";
import { AnimateInput, GenerationResult } from "@/providers/types";
import { videoCall, withDirectSpend } from "@/server/direct-spend";

// Server Function: the only client path into @/providers for video. The
// provider is the card's own; a retired or unknown model (Sora) is refused with
// the reason, never swapped. Mirrors edit.ts; Zod is the trust boundary. The
// video reserves its pinned max against the monthly cap and records what it
// cost, like the image calls. The card's length snaps to the nearest one its
// model renders (Veo: 4, 6 or 8 s), so the price and the call agree.
export async function animateVideo(
  input: AnimateInput,
): Promise<GenerationResult> {
  const raw = AnimateInput.parse(input);
  assertModel(raw.model, "video");
  const parsed = {
    ...raw,
    durationSec: snapSeconds(
      raw.durationSec,
      videoSecondsFor(undefined, raw.model),
    ),
  };
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

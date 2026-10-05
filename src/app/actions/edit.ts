"use server";

import { generationModel } from "@/domain/model-defaults";
import { getImageProvider } from "@/providers/registry";
import { GenerationResult, ImageEditInput } from "@/providers/types";
import { withDirectSpend } from "@/server/direct-spend";

// Server Function: the only client path into @/providers for image editing. The
// provider comes from the card's model under the generation policy (OpenAI only:
// a card saved on Google runs on the OpenAI default). Mirrors generate.ts; the
// Zod parse is the trust boundary. It reserves against the monthly cap and
// records its cost (the queue does the same for planned projects).
export async function editImage(
  input: ImageEditInput,
): Promise<GenerationResult> {
  const parsed = ImageEditInput.parse(input);
  const safe = { ...parsed, model: generationModel(parsed.model, "image") };
  return withDirectSpend(safe.model, safe.model.aspect, async (beforeCall) =>
    GenerationResult.parse(
      await getImageProvider(safe.model.provider).edit(safe, { beforeCall }),
    ),
  );
}

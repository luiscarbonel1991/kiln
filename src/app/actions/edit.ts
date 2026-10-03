"use server";

import { generationModel } from "@/domain/model-defaults";
import { getImageProvider } from "@/providers/registry";
import { GenerationResult, ImageEditInput } from "@/providers/types";

// Server Function: the only client path into @/providers for image editing. The
// provider comes from the card's model under the generation policy (OpenAI only:
// a card saved on Google runs on the OpenAI default). Mirrors generate.ts; the
// Zod parse is the trust boundary.
export async function editImage(
  input: ImageEditInput,
): Promise<GenerationResult> {
  const parsed = ImageEditInput.parse(input);
  const safe = { ...parsed, model: generationModel(parsed.model, "image") };
  const result = await getImageProvider(safe.model.provider).edit(safe);
  return GenerationResult.parse(result);
}

"use server";

import { getImageProvider } from "@/providers/registry";
import { GenerationResult, ImageEditInput } from "@/providers/types";

// Server Function: the only client path into @/providers for image editing. The
// provider is resolved from input.model.provider (per-card switchable). Mirrors
// generate.ts; the Zod parse is the trust boundary.
export async function editImage(
  input: ImageEditInput,
): Promise<GenerationResult> {
  const safe = ImageEditInput.parse(input);
  const result = await getImageProvider(safe.model.provider).edit(safe);
  return GenerationResult.parse(result);
}

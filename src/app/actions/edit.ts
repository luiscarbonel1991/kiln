"use server";

import { assertModel } from "@/domain/model-defaults";
import { getImageProvider } from "@/providers/registry";
import { GenerationResult, ImageEditInput } from "@/providers/types";
import { imageCall, withDirectSpend } from "@/server/direct-spend";

// Server Function: the only client path into @/providers for image editing. The
// provider is the card's own; a model Kiln does not offer is refused, never
// swapped. Mirrors generate.ts; the Zod parse is the trust boundary. It
// reserves against the monthly cap and records its cost (the queue does the
// same for planned projects).
export async function editImage(
  input: ImageEditInput,
): Promise<GenerationResult> {
  const parsed = ImageEditInput.parse(input);
  assertModel(parsed.model, "image");
  return withDirectSpend(
    imageCall(parsed.model, parsed.model.aspect),
    async (beforeCall) =>
      GenerationResult.parse(
        await getImageProvider(parsed.model.provider).edit(parsed, {
          beforeCall,
        }),
      ),
  );
}

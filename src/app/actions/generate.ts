"use server";

import { z } from "zod";
import { ModelConfig } from "@/domain/model-config";
import { defaultImageModel } from "@/domain/model-defaults";
import { getImageProvider } from "@/providers/registry";
import { GenerationResult, ImageGenInput } from "@/providers/types";
import { imageCall, withDirectSpend } from "@/server/direct-spend";

const PromptInput = z.string().trim().min(1, "Describe the image to generate.");

// Server Function: the only path from the client into @/providers. The prompt
// Zod guard is the trust boundary (Server Functions are POST-reachable).
export async function generateImage(prompt: string): Promise<GenerationResult> {
  const safePrompt = PromptInput.parse(prompt);
  const input = ImageGenInput.parse({
    prompt: safePrompt,
    model: ModelConfig.parse(defaultImageModel()),
  });
  return withDirectSpend(
    imageCall(input.model, input.model.aspect),
    async (beforeCall) =>
      GenerationResult.parse(
        await getImageProvider(input.model.provider).generate(input, {
          beforeCall,
        }),
      ),
  );
}

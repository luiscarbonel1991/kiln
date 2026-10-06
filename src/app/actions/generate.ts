"use server";

import { z } from "zod";
import { ModelConfig } from "@/domain/model-config";
import { DEFAULT_PROVIDER } from "@/domain/model-defaults";
import { MODELS } from "@/providers/models";
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
    model: ModelConfig.parse({
      provider: DEFAULT_PROVIDER,
      model: MODELS[DEFAULT_PROVIDER].image,
    }),
  });
  return withDirectSpend(
    imageCall(input.model, input.model.aspect),
    async (beforeCall) =>
      GenerationResult.parse(
        await getImageProvider(DEFAULT_PROVIDER).generate(input, {
          beforeCall,
        }),
      ),
  );
}

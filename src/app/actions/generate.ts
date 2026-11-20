"use server";

import { z } from "zod";
import { ModelConfig } from "@/domain/model-config";
import { getImageProvider } from "@/providers/registry";
import { GenerationResult, ImageGenInput } from "@/providers/types";
import { imageCall, withDirectSpend } from "@/server/direct-spend";
import { makerAction } from "@/server/guarded";
import { getMakerModelSetup } from "@/server/maker-repository";

const PromptInput = z.string().trim().min(1, "Describe the image to generate.");

// Server Function: the only path from the client into @/providers. The prompt
// Zod guard is the trust boundary (Server Functions are POST-reachable). The
// studio explores, so it runs on the draft route's first model.
export const generateImage = makerAction(
  async (maker, prompt: string): Promise<GenerationResult> => {
    const safePrompt = PromptInput.parse(prompt);
    const { models, routes } = await getMakerModelSetup(maker);
    const input = ImageGenInput.parse({
      prompt: safePrompt,
      model: ModelConfig.parse(routes?.draft.models[0] ?? models.image),
    });
    return withDirectSpend(
      maker,
      imageCall(input.model, input.model.aspect),
      async (beforeCall) =>
        GenerationResult.parse(
          await getImageProvider(input.model.provider).generate(input, {
            beforeCall,
          }),
        ),
    );
  },
);

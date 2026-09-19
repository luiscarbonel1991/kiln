import { randomUUID } from "node:crypto";
import { toFile } from "openai";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { assertCapability, OPENAI_CAPS } from "@/providers/capabilities";
import type { ImageProvider } from "@/providers/interfaces";
import { MODELS, resolveImageModel } from "@/providers/models";
import { getOpenAI, hasOpenAIKey } from "@/providers/openai/client";
import {
  GenerationResult,
  type ImageComposeInput,
  type ImageEditInput,
  type ImageGenInput,
} from "@/providers/types";

// Mock fallback when OPENAI_API_KEY is absent.
function mockResult(label: string): GenerationResult {
  return GenerationResult.parse({
    assets: [
      {
        id: `openai-${label}-mock`,
        url: `https://stub.local/openai/${label}.png`,
        mime: "image/png",
      },
    ],
    provider: "openai",
    model: MODELS.openai.image,
  });
}

// Map our aspect ratios to gpt-image supported sizes.
function sizeFor(aspect: string): "1024x1024" | "1024x1536" | "1536x1024" {
  if (["4:5", "2:3", "9:16", "3:4"].includes(aspect)) return "1024x1536";
  if (["5:4", "3:2", "16:9", "4:3"].includes(aspect)) return "1536x1024";
  return "1024x1024";
}

// gpt-image always returns base64 (b64_json); store it and return a durable URL.
async function storeB64(
  b64: string | undefined,
  model: string,
): Promise<GenerationResult> {
  if (!b64) throw new Error("OpenAI returned no image");
  const url = await storeAsset(
    new Uint8Array(Buffer.from(b64, "base64")),
    "image/png",
    "cards",
  );
  return GenerationResult.parse({
    assets: [{ id: randomUUID(), url, mime: "image/png" }],
    provider: "openai",
    model,
  });
}

export const openaiImageProvider: ImageProvider = {
  id: "openai",
  capabilities: OPENAI_CAPS,
  async generate(input: ImageGenInput) {
    assertCapability(this, "generate");
    if (!hasOpenAIKey()) return mockResult("generate");
    const model = resolveImageModel("openai", input.model.model);
    const r = await getOpenAI().images.generate({
      model,
      prompt: input.prompt,
      size: sizeFor(input.model.aspect),
    });
    return storeB64(r.data?.[0]?.b64_json, model);
  },
  async edit(input: ImageEditInput) {
    assertCapability(this, "edit", input.imageInputs.length);
    if (!hasOpenAIKey()) return mockResult("edit");
    const model = resolveImageModel("openai", input.model.model);
    const master = await fetchAsset(input.masterAssetUrl);
    const image = await toFile(master.bytes, "master.png", {
      type: master.mime,
    });
    const r = await getOpenAI().images.edit({
      model,
      image,
      prompt: input.negative
        ? `${input.prompt}\nAvoid: ${input.negative}`
        : input.prompt,
      size: sizeFor(input.model.aspect),
    });
    return storeB64(r.data?.[0]?.b64_json, model);
  },
  async compose(input: ImageComposeInput) {
    // Gated: OPENAI_CAPS.compose === false -> assertCapability throws CapabilityError.
    assertCapability(this, "compose", input.imageInputs.length);
    return mockResult("compose");
  },
};

import { randomUUID } from "node:crypto";
import { toFile } from "openai";
import { OPENAI_2K, sizeOn } from "@/domain/image-size";
import {
  assertModel,
  DEFAULT_IMAGE_QUALITY,
  type ImageQuality,
  type ImageSize,
} from "@/domain/model-defaults";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { assertCapability, OPENAI_CAPS } from "@/providers/capabilities";
import type {
  DirectCallOptions,
  EditBytesResult,
  ImageProvider,
} from "@/providers/interfaces";
import { mockEditCopy } from "@/providers/mock/edit-copy";
import { mockDelay, mockOutage, providerMode } from "@/providers/mode";
import { getOpenAI, hasOpenAIKey } from "@/providers/openai/client";
import {
  GenerationResult,
  type GenerationUsage,
  type ImageComposeInput,
  type ImageEditInput,
  type ImageGenInput,
} from "@/providers/types";

// Mock fallback when OPENAI_API_KEY is absent or KILN_PROVIDERS=mock. Each stub
// URL is unique, so a re-roll is a new output (approvals compare URLs).
function mockResult(label: string, model: string): GenerationResult {
  return GenerationResult.parse({
    assets: [
      {
        id: `openai-${label}-mock`,
        url: `https://stub.local/openai/${label}-${randomUUID()}.png`,
        mime: "image/png",
      },
    ],
    provider: "openai",
    model,
  });
}

// Plausible usage for mock runs, so costs show up in mock mode (mock jobs never
// count as spend).
const MOCK_USAGE: GenerationUsage = {
  inputTextTokens: 250,
  inputImageTokens: 1100,
  outputTokens: 1800,
};

// Map our aspect ratios to gpt-image supported sizes; at 2K (sizeOn), GPT
// Image 2's own size for the aspect.
function sizeFor(model: {
  model: string;
  aspect: string;
  size?: ImageSize;
}): string {
  const { aspect } = model;
  const large = OPENAI_2K[aspect];
  if (large && sizeOn({ ...model, provider: "openai" }, aspect) === "2k") {
    return `${large.width}x${large.height}`;
  }
  if (["4:5", "2:3", "9:16", "3:4"].includes(aspect)) return "1024x1536";
  if (["5:4", "3:2", "16:9", "4:3"].includes(aspect)) return "1536x1024";
  return "1024x1024";
}

// The API's usage block (input split into text and image tokens) as ours.
function usageOf(usage: unknown): GenerationUsage | undefined {
  const u = usage as {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  } | null;
  if (!u || typeof u.output_tokens !== "number") return undefined;
  const image = u.input_tokens_details?.image_tokens ?? 0;
  const text =
    u.input_tokens_details?.text_tokens ?? (u.input_tokens ?? 0) - image;
  return {
    inputTextTokens: Math.max(0, text),
    inputImageTokens: Math.max(0, image),
    outputTokens: u.output_tokens,
  };
}

// The model a request runs: refused (never swapped) when Kiln does not offer it.
const modelOf = (input: { model: { model: string } }) =>
  assertModel({ provider: "openai", model: input.model.model }, "image").id;

const qualityOf = (input: { model: { quality?: ImageQuality } }) =>
  input.model.quality ?? DEFAULT_IMAGE_QUALITY;

function editParams(input: ImageEditInput, model: string) {
  return {
    model,
    prompt: input.negative
      ? `${input.prompt}\nAvoid: ${input.negative}`
      : input.prompt,
    size: sizeFor(input.model),
    quality: qualityOf(input),
  };
}

// gpt-image always returns base64 (b64_json); store it and return a durable URL.
async function storeB64(
  b64: string | undefined,
  model: string,
  usage: GenerationUsage | undefined,
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
    usage,
  });
}

// The images an edit reads, in order: the reference (the product) first, then
// each further reference (a material sample), as the prompt names them. The
// Images API takes several for GPT image models; one sent alone would drop
// the rest without a word.
async function editImages(
  input: ImageEditInput,
  master?: Awaited<ReturnType<typeof fetchAsset>>,
) {
  const assets = await Promise.all([
    master ?? fetchAsset(input.masterAssetUrl),
    ...input.imageInputs.map((url) => fetchAsset(url)),
  ]);
  return Promise.all(
    assets.map((asset, i) =>
      toFile(asset.bytes, i === 0 ? "master.png" : `reference-${i}.png`, {
        type: asset.mime,
      }),
    ),
  );
}

export const openaiImageProvider: ImageProvider = {
  id: "openai",
  capabilities: OPENAI_CAPS,
  // Direct calls make one request (no SDK retries): one call, one cost.
  async generate(input: ImageGenInput, options?: DirectCallOptions) {
    assertCapability(this, "generate");
    const model = modelOf(input);
    if (!hasOpenAIKey()) {
      await mockDelay();
      return mockResult("generate", model);
    }
    await options?.beforeCall?.();
    const r = await getOpenAI().images.generate(
      {
        model,
        prompt: input.prompt,
        size: sizeFor(input.model),
        quality: qualityOf(input),
      },
      { maxRetries: 0 },
    );
    return storeB64(r.data?.[0]?.b64_json, model, usageOf(r.usage));
  },
  async edit(input: ImageEditInput, options?: DirectCallOptions) {
    assertCapability(this, "edit", input.imageInputs.length);
    const model = modelOf(input);
    if (!hasOpenAIKey()) {
      await mockDelay();
      return providerMode() === "mock"
        ? mockEditCopy(input.masterAssetUrl, "openai", model)
        : mockResult("edit", model);
    }
    const image = await editImages(input);
    await options?.beforeCall?.();
    const r = await getOpenAI().images.edit(
      { ...editParams(input, model), image },
      { maxRetries: 0 },
    );
    return storeB64(r.data?.[0]?.b64_json, model, usageOf(r.usage));
  },
  async editBytes(
    input: ImageEditInput,
    options: { timeoutMs: number; beforeCall?: () => Promise<void> },
  ): Promise<EditBytesResult> {
    assertCapability(this, "edit", input.imageInputs.length);
    const model = modelOf(input);
    const master = await fetchAsset(input.masterAssetUrl);
    if (!hasOpenAIKey()) {
      // The stub "edit" returns the reference itself: a real, storable image,
      // so mock runs fill the board with something to look at. Only a mock run
      // marks its call (mock jobs never count); a live run without a key makes
      // no call, so nothing is counted.
      mockOutage("openai");
      if (providerMode() === "mock") await options.beforeCall?.();
      await mockDelay();
      return {
        bytes: new Uint8Array(master.bytes),
        mime: master.mime,
        model,
        usage: providerMode() === "mock" ? MOCK_USAGE : undefined,
      };
    }
    const image = await editImages(input, master);
    await options.beforeCall?.();
    const r = await getOpenAI().images.edit(
      { ...editParams(input, model), image },
      { timeout: options.timeoutMs, maxRetries: 0 },
    );
    const b64 = r.data?.[0]?.b64_json;
    return {
      bytes: b64 ? new Uint8Array(Buffer.from(b64, "base64")) : null,
      mime: "image/png",
      model,
      usage: usageOf(r.usage),
    };
  },
  async compose(input: ImageComposeInput) {
    // Gated: OPENAI_CAPS.compose === false -> assertCapability throws CapabilityError.
    assertCapability(this, "compose", input.imageInputs.length);
    return mockResult("compose", input.model.model);
  },
};

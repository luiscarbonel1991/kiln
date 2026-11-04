import { randomUUID } from "node:crypto";
import { Modality, type Part } from "@google/genai";
import { sizeOn } from "@/domain/image-size";
import { assertModel, type ImageSize } from "@/domain/model-defaults";
import {
  type FetchedAsset,
  fetchAsset,
  storeAsset,
} from "@/providers/asset-bytes";
import { assertCapability, GOOGLE_CAPS } from "@/providers/capabilities";
import { getGenAI, hasGoogleKey, ONE_REQUEST } from "@/providers/google/client";
import { imageUsage } from "@/providers/google/usage";
import type {
  DirectCallOptions,
  EditBytesResult,
  ImageProvider,
} from "@/providers/interfaces";
import { mockEditCopy } from "@/providers/mock/edit-copy";
import { mockDelay, mockOutage, providerMode } from "@/providers/mode";
import {
  GenerationResult,
  type GenerationUsage,
  type ImageComposeInput,
  type ImageEditInput,
  type ImageGenInput,
} from "@/providers/types";

// Gemini images under the same money rules as OpenAI's: `beforeCall` right
// before the one paid request (after the free reference fetches), no SDK retry
// or continuation (see client.ts), a timeout, and the usage it reports, so
// the measured cost is recorded.

// Mock fallback when GOOGLE_API_KEY is absent or KILN_PROVIDERS=mock. Each stub
// URL is unique, so a re-roll is a new output (approvals compare URLs).
function mockResult(label: string, model: string): GenerationResult {
  return GenerationResult.parse({
    assets: [
      {
        id: `google-${label}-mock`,
        url: `https://stub.local/google/${label}-${randomUUID()}.png`,
        mime: "image/png",
      },
    ],
    provider: "google",
    model,
  });
}

// Plausible usage for mock runs, so costs show up in mock mode (mock jobs never
// count as spend).
const MOCK_USAGE: GenerationUsage = {
  inputTextTokens: 300,
  inputImageTokens: 1100,
  outputTokens: 1120,
  outputTextTokens: 0,
};

// A direct (studio) call's bound; the queue passes its own.
const DIRECT_TIMEOUT_MS = 180_000;

// Gemini's image model only accepts a fixed aspectRatio set (no 4:5 / 5:4, which
// our listing slots use), so snap each slot aspect to the nearest supported value.
// Unlike `strength`, aspectRatio IS honored by the image model — it's the lever
// that makes the hero render square and the in-use render portrait.
const GEMINI_ASPECTS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
]);
export function aspectFor(aspect: string): string {
  if (GEMINI_ASPECTS.has(aspect)) return aspect;
  if (aspect === "4:5") return "3:4";
  if (aspect === "5:4") return "4:3";
  return "1:1";
}

// The model a request runs: refused (never swapped) when Kiln does not offer it.
const modelOf = (input: { model: { model: string } }) =>
  assertModel({ provider: "google", model: input.model.model }, "image").id;

// The frame a request asks for: its aspect, and 2K where the model offers it.
interface Frame {
  aspect: string | undefined;
  size: ImageSize;
}
const frameOf = (input: {
  model: { model: string; aspect?: string; size?: ImageSize };
}): Frame => ({
  aspect: input.model.aspect,
  size: sizeOn({ ...input.model, provider: "google" }, input.model.aspect),
});

interface GeminiImage {
  bytes: Uint8Array | null;
  mime: string;
  usage?: GenerationUsage;
  refusal?: string;
}

// One paid generateContent call; the first returned image as bytes. An answer
// without an image (a safety block) keeps its usage and says why.
async function callGemini(
  contents: string | Part[],
  model: string,
  { aspect, size }: Frame,
  options: { timeoutMs: number; beforeCall?: () => Promise<void> },
): Promise<GeminiImage> {
  await options.beforeCall?.();
  const res = await getGenAI().models.generateContent({
    model,
    contents,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      ...(aspect || size === "2k"
        ? {
            imageConfig: {
              ...(aspect ? { aspectRatio: aspectFor(aspect) } : {}),
              ...(size === "2k" ? { imageSize: "2K" } : {}),
            },
          }
        : {}),
      httpOptions: { timeout: options.timeoutMs },
      ...ONE_REQUEST,
    },
  });
  const usage = imageUsage(res.usageMetadata);
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data;
    if (data) {
      return {
        bytes: new Uint8Array(Buffer.from(data, "base64")),
        mime: part.inlineData?.mimeType ?? "image/png",
        usage,
      };
    }
  }
  const reason =
    res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason;
  return {
    bytes: null,
    mime: "image/png",
    usage,
    refusal: reason ? `Gemini returned no image: ${reason}` : undefined,
  };
}

async function stored(
  image: GeminiImage,
  model: string,
): Promise<GenerationResult> {
  if (!image.bytes)
    throw new Error(image.refusal ?? "Gemini returned no image");
  const url = await storeAsset(image.bytes, image.mime, "cards");
  return GenerationResult.parse({
    assets: [{ id: randomUUID(), url, mime: image.mime }],
    provider: "google",
    model,
    usage: image.usage,
  });
}

function editText(input: ImageEditInput): string {
  return input.negative
    ? `${input.prompt}\nAvoid: ${input.negative}`
    : input.prompt;
}

function editContents(
  input: ImageEditInput,
  master: FetchedAsset,
  refs: FetchedAsset[],
): Part[] {
  return [
    { text: editText(input) },
    { inlineData: { mimeType: master.mime, data: master.base64 } },
    ...refs.map((r) => ({
      inlineData: { mimeType: r.mime, data: r.base64 },
    })),
  ];
}

export const googleImageProvider: ImageProvider = {
  id: "google",
  capabilities: GOOGLE_CAPS,
  async generate(input: ImageGenInput, options?: DirectCallOptions) {
    assertCapability(this, "generate");
    const model = modelOf(input);
    if (!hasGoogleKey()) {
      await mockDelay();
      return mockResult("generate", model);
    }
    const image = await callGemini(input.prompt, model, frameOf(input), {
      timeoutMs: DIRECT_TIMEOUT_MS,
      beforeCall: options?.beforeCall,
    });
    return stored(image, model);
  },
  async edit(input: ImageEditInput, options?: DirectCallOptions) {
    assertCapability(this, "edit", input.imageInputs.length);
    const model = modelOf(input);
    if (!hasGoogleKey()) {
      await mockDelay();
      return providerMode() === "mock"
        ? mockEditCopy(input.masterAssetUrl, "google", model)
        : mockResult("edit", model);
    }
    const master = await fetchAsset(input.masterAssetUrl);
    const refs = await Promise.all(input.imageInputs.map((u) => fetchAsset(u)));
    const image = await callGemini(
      editContents(input, master, refs),
      model,
      frameOf(input),
      { timeoutMs: DIRECT_TIMEOUT_MS, beforeCall: options?.beforeCall },
    );
    return stored(image, model);
  },
  // The queue's edit: bytes and usage, nothing stored (the worker records the
  // cost first, then stores with retries — never the paid call).
  async editBytes(
    input: ImageEditInput,
    options: { timeoutMs: number; beforeCall?: () => Promise<void> },
  ): Promise<EditBytesResult> {
    assertCapability(this, "edit", input.imageInputs.length);
    const model = modelOf(input);
    const master = await fetchAsset(input.masterAssetUrl);
    if (!hasGoogleKey()) {
      // The stub returns the reference itself, like OpenAI's: only a mock run
      // marks its call (mock jobs never count).
      mockOutage("google");
      if (providerMode() === "mock") await options.beforeCall?.();
      await mockDelay();
      return {
        bytes: new Uint8Array(master.bytes),
        mime: master.mime,
        model,
        usage: providerMode() === "mock" ? MOCK_USAGE : undefined,
      };
    }
    const refs = await Promise.all(input.imageInputs.map((u) => fetchAsset(u)));
    const image = await callGemini(
      editContents(input, master, refs),
      model,
      frameOf(input),
      options,
    );
    return { ...image, model };
  },
  async compose(input: ImageComposeInput, options?: DirectCallOptions) {
    assertCapability(this, "compose", input.imageInputs.length);
    const model = modelOf(input);
    if (!hasGoogleKey()) {
      await mockDelay();
      return mockResult("compose", model);
    }
    const imgs = await Promise.all(input.imageInputs.map((u) => fetchAsset(u)));
    const contents: Part[] = [
      { text: input.prompt },
      ...imgs.map((i) => ({
        inlineData: { mimeType: i.mime, data: i.base64 },
      })),
    ];
    const image = await callGemini(contents, model, frameOf(input), {
      timeoutMs: DIRECT_TIMEOUT_MS,
      beforeCall: options?.beforeCall,
    });
    return stored(image, model);
  },
};

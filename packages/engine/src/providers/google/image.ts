import { randomUUID } from "node:crypto";
import { Modality, type Part } from "@google/genai";
import { assertModel } from "@/domain/model-defaults";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { assertCapability, GOOGLE_CAPS } from "@/providers/capabilities";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import type { ImageProvider } from "@/providers/interfaces";
import {
  GenerationResult,
  type ImageComposeInput,
  type ImageEditInput,
  type ImageGenInput,
} from "@/providers/types";

// Mock fallback when GOOGLE_API_KEY is absent (keeps the app + tests running
// without credentials; the URL is a non-resolving stub the UI renders as a gradient).
function mockResult(label: string, model: string): GenerationResult {
  return GenerationResult.parse({
    assets: [
      {
        id: `google-${label}-mock`,
        url: `https://stub.local/google/${label}.png`,
        mime: "image/png",
      },
    ],
    provider: "google",
    model,
  });
}

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

// Call a Gemini image model, store the first returned image to object storage,
// return a durable public URL. Image bytes are base64 inlineData parts. The
// optional aspect pins the output frame (the model ignores it when absent).
// `model` is the per-card choice, already vetted against the catalog.
async function runGemini(
  contents: string | Part[],
  model: string,
  aspect?: string,
): Promise<GenerationResult> {
  const res = await getGenAI().models.generateContent({
    model,
    contents,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      ...(aspect ? { imageConfig: { aspectRatio: aspectFor(aspect) } } : {}),
    },
  });
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data;
    if (data) {
      const mime = part.inlineData?.mimeType ?? "image/png";
      const url = await storeAsset(
        new Uint8Array(Buffer.from(data, "base64")),
        mime,
        "cards",
      );
      return GenerationResult.parse({
        assets: [{ id: randomUUID(), url, mime }],
        provider: "google",
        model,
      });
    }
  }
  throw new Error("Gemini returned no image");
}

// The model a request runs: refused (never swapped) when Kiln does not offer it.
const modelOf = (input: { model: { model: string } }) =>
  assertModel({ provider: "google", model: input.model.model }, "image").id;

function editText(input: ImageEditInput): string {
  return input.negative
    ? `${input.prompt}\nAvoid: ${input.negative}`
    : input.prompt;
}

export const googleImageProvider: ImageProvider = {
  id: "google",
  capabilities: GOOGLE_CAPS,
  async generate(input: ImageGenInput) {
    assertCapability(this, "generate");
    const model = modelOf(input);
    if (!hasGoogleKey()) return mockResult("generate", model);
    return runGemini(input.prompt, model, input.model.aspect);
  },
  async edit(input: ImageEditInput) {
    assertCapability(this, "edit", input.imageInputs.length);
    const model = modelOf(input);
    if (!hasGoogleKey()) return mockResult("edit", model);
    const master = await fetchAsset(input.masterAssetUrl);
    const refs = await Promise.all(input.imageInputs.map((u) => fetchAsset(u)));
    const contents: Part[] = [
      { text: editText(input) },
      { inlineData: { mimeType: master.mime, data: master.base64 } },
      ...refs.map((r) => ({
        inlineData: { mimeType: r.mime, data: r.base64 },
      })),
    ];
    return runGemini(contents, model, input.model.aspect);
  },
  async compose(input: ImageComposeInput) {
    assertCapability(this, "compose", input.imageInputs.length);
    const model = modelOf(input);
    if (!hasGoogleKey()) return mockResult("compose", model);
    const imgs = await Promise.all(input.imageInputs.map((u) => fetchAsset(u)));
    const contents: Part[] = [
      { text: input.prompt },
      ...imgs.map((i) => ({
        inlineData: { mimeType: i.mime, data: i.base64 },
      })),
    ];
    return runGemini(contents, model, input.model.aspect);
  },
};

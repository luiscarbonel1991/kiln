import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import type { VideoProvider } from "@/providers/interfaces";
import { MODELS, resolveVideoModel } from "@/providers/models";
import { type AnimateInput, GenerationResult } from "@/providers/types";

// Mock fallback when GOOGLE_API_KEY is absent.
function mockResult(): GenerationResult {
  return GenerationResult.parse({
    assets: [
      {
        id: "google-animate-mock",
        url: "https://stub.local/google/animate.mp4",
        mime: "video/mp4",
      },
    ],
    provider: "google",
    model: MODELS.google.video,
  });
}

function isFetchable(ref: string): boolean {
  return /^(https?:|data:)/.test(ref) && !ref.includes("stub.local");
}

// Real Veo (image→video). Veo is a long-running operation: kick off, poll, then
// download the mp4 bytes and store them. NOTE: Veo is paid-tier only — without
// billing the API throws and the card surfaces an error. Falls back to mock w/o key.
export const googleVideoProvider: VideoProvider = {
  id: "google",
  async animate(input: AnimateInput) {
    if (!hasGoogleKey()) return mockResult();
    const ai = getGenAI();
    const model = resolveVideoModel("google", input.model.model);

    let image: { imageBytes: string; mimeType: string } | undefined;
    if (isFetchable(input.startFrameAssetId)) {
      const frame = await fetchAsset(input.startFrameAssetId);
      image = { imageBytes: frame.base64, mimeType: frame.mime };
    }

    let op = await ai.models.generateVideos({
      model,
      prompt: `${input.prompt}. Motion: ${input.motion}.`,
      ...(image ? { image } : {}),
    });
    while (!op.done) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      op = await ai.operations.getVideosOperation({ operation: op });
    }

    const video = op.response?.generatedVideos?.[0]?.video;
    if (!video) {
      throw new Error("Veo returned no video");
    }

    // The SDK downloads to a path; stage in tmp, then push bytes to object storage.
    const tmp = join(tmpdir(), `kiln-veo-${randomUUID()}.mp4`);
    await ai.files.download({ file: video, downloadPath: tmp });
    const bytes = await readFile(tmp);
    await unlink(tmp).catch(() => undefined);

    const url = await storeAsset(new Uint8Array(bytes), "video/mp4", "videos");
    return GenerationResult.parse({
      assets: [{ id: randomUUID(), url, mime: "video/mp4" }],
      provider: "google",
      model,
    });
  },
};

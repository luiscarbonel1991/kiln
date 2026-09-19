import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { toFile } from "openai";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import type { VideoProvider } from "@/providers/interfaces";
import { MODELS, resolveVideoModel } from "@/providers/models";
import { getOpenAI, hasOpenAIKey } from "@/providers/openai/client";
import { GenerationResult } from "@/providers/types";

const execFileP = promisify(execFile);

// Mock fallback when OPENAI_API_KEY is absent.
function mockResult(): GenerationResult {
  return GenerationResult.parse({
    assets: [
      {
        id: "openai-animate-mock",
        url: "https://stub.local/openai/animate.mp4",
        mime: "video/mp4",
      },
    ],
    provider: "openai",
    model: MODELS.openai.video,
  });
}

function isFetchable(ref: string): boolean {
  return /^(https?:|data:)/.test(ref) && !ref.includes("stub.local");
}

// Sora accepts a fixed seconds enum; snap the card's duration to the nearest.
function secondsFor(durationSec: number): "4" | "8" | "12" {
  if (durationSec <= 6) return "4";
  if (durationSec <= 10) return "8";
  return "12";
}

// 720x1280 / 1280x720 are valid on both sora-2 and sora-2-pro (the 1024x1792
// pair is pro-only, so we stay on the shared sizes). Portrait-ish aspects map to
// portrait; 1:1 leans portrait (the social default).
function sizeFor(aspect: string): {
  size: "720x1280" | "1280x720";
  w: number;
  h: number;
} {
  const landscape = ["16:9", "3:2", "4:3", "5:4", "21:9"].includes(aspect);
  return landscape
    ? { size: "1280x720", w: 1280, h: 720 }
    : { size: "720x1280", w: 720, h: 1280 };
}

// Sora requires the input_reference image to match the video resolution exactly,
// so cover-crop the start frame to the target size. ImageMagick is already a
// system dependency (centerline vectorize); temp files are scoped + cleaned.
async function frameSizedTo(
  bytes: Buffer,
  w: number,
  h: number,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-sora-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.png");
    await writeFile(src, bytes);
    await execFileP("magick", [
      src,
      "-resize",
      `${w}x${h}^`,
      "-gravity",
      "center",
      "-extent",
      `${w}x${h}`,
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Real Sora (image->video). Like Veo it is a long-running operation: create,
// poll until it leaves the queue, then download the mp4 bytes and store them.
export const openaiVideoProvider: VideoProvider = {
  id: "openai",
  async animate(input) {
    if (!hasOpenAIKey()) return mockResult();
    const client = getOpenAI();
    const model = resolveVideoModel("openai", input.model.model);
    const { size, w, h } = sizeFor(input.model.aspect);

    let inputReference: Awaited<ReturnType<typeof toFile>> | undefined;
    if (isFetchable(input.startFrameAssetId)) {
      const frame = await fetchAsset(input.startFrameAssetId);
      const sized = await frameSizedTo(frame.bytes, w, h);
      inputReference = await toFile(sized, "frame.png", { type: "image/png" });
    }

    let video = await client.videos.create({
      model,
      prompt: `${input.prompt}. Motion: ${input.motion}.`,
      seconds: secondsFor(input.durationSec),
      size,
      ...(inputReference ? { input_reference: inputReference } : {}),
    });
    while (video.status === "queued" || video.status === "in_progress") {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      video = await client.videos.retrieve(video.id);
    }
    if (video.status !== "completed") {
      throw new Error(video.error?.message ?? "Sora returned no video");
    }

    const res = await client.videos.downloadContent(video.id);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const url = await storeAsset(bytes, "video/mp4", "videos");
    return GenerationResult.parse({
      assets: [{ id: randomUUID(), url, mime: "video/mp4" }],
      provider: "openai",
      model,
    });
  },
};

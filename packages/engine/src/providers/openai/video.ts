import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { toFile } from "openai";
import { soraSeconds } from "@/domain/generation-cost";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import type {
  AnimateRequest,
  VideoBytesResult,
  VideoProvider,
} from "@/providers/interfaces";
import { mockDelay } from "@/providers/mode";
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

// The paid create is never retried by the SDK (a retry after a timeout could
// start a second render); the polls and the download are free and keep the
// SDK's retries. The poll stops before the direct-spend row's 15 min lease.
const CREATE_TIMEOUT_MS = 120_000;
const POLL_MS = 10_000;
export const VIDEO_POLL_DEADLINE_MS = 12 * 60_000;

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

// A stand-in clip for mock runs and key-free tests: the start frame itself
// (an image, not a video) when it can be read, else a 1x1 PNG, so the board's
// flow can be exercised without a paid call.
const PIXEL = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

async function mockBytes(input: AnimateRequest): Promise<VideoBytesResult> {
  await mockDelay();
  const seconds = soraSeconds(input.durationSec);
  const model = resolveVideoModel("openai", input.model.model);
  if (isFetchable(input.startFrameAssetId)) {
    try {
      const frame = await fetchAsset(input.startFrameAssetId);
      return { bytes: frame.bytes, mime: frame.mime, model, seconds };
    } catch {
      // fall through to the pixel
    }
  }
  return { bytes: PIXEL, mime: "image/png", model, seconds };
}

// Real Sora (image->video). Like Veo it is a long-running operation: create,
// poll until it leaves the queue, then download the mp4 bytes. A render that
// fails or outlives the deadline throws without an HTTP status: the job or
// spend row counts it at its estimate (it may still be charged).
async function animateBytes(
  input: AnimateRequest,
  options?: { beforeCall?: () => Promise<void> },
): Promise<VideoBytesResult> {
  if (!hasOpenAIKey()) return mockBytes(input);
  const client = getOpenAI();
  const model = resolveVideoModel("openai", input.model.model);
  const { size, w, h } = sizeFor(input.model.aspect);
  const seconds = soraSeconds(input.durationSec);

  let inputReference: Awaited<ReturnType<typeof toFile>> | undefined;
  if (isFetchable(input.startFrameAssetId)) {
    const frame = await fetchAsset(input.startFrameAssetId);
    const sized = await frameSizedTo(frame.bytes, w, h);
    inputReference = await toFile(sized, "frame.png", { type: "image/png" });
  }

  await options?.beforeCall?.();
  let video = await client.videos.create(
    {
      model,
      prompt: `${input.prompt}. Motion: ${input.motion}.`,
      seconds: String(seconds) as "4" | "8" | "12",
      size,
      ...(inputReference ? { input_reference: inputReference } : {}),
    },
    { maxRetries: 0, timeout: CREATE_TIMEOUT_MS },
  );
  const deadline = Date.now() + VIDEO_POLL_DEADLINE_MS;
  while (video.status === "queued" || video.status === "in_progress") {
    if (Date.now() >= deadline) {
      throw new Error(
        `Sora did not finish within ${VIDEO_POLL_DEADLINE_MS / 60_000} minutes; the render may still be charged.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    video = await client.videos.retrieve(video.id);
  }
  if (video.status !== "completed") {
    throw new Error(video.error?.message ?? "Sora returned no video");
  }
  const res = await client.videos.downloadContent(video.id);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: "video/mp4",
    model,
    seconds,
  };
}

export const openaiVideoProvider: VideoProvider = {
  id: "openai",
  animateBytes,
  async animate(input, options) {
    if (!hasOpenAIKey()) return mockResult();
    const clip = await animateBytes(input, options);
    const url = await storeAsset(clip.bytes, clip.mime, "videos");
    return GenerationResult.parse({
      assets: [{ id: randomUUID(), url, mime: clip.mime }],
      provider: "openai",
      model: clip.model,
    });
  },
};

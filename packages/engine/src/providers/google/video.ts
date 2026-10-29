import { randomUUID } from "node:crypto";
import {
  assertModel,
  DEFAULT_VIDEO_RESOLUTION,
  ModelRefused,
  type VideoResolution,
} from "@/domain/model-defaults";
import { errorMessage } from "@/domain/queue";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import {
  frameSizedTo,
  isFetchable,
  startFrameStandIn,
} from "@/providers/frame";
import {
  getGenAI,
  googleApiKey,
  hasGoogleKey,
} from "@/providers/google/client";
import type {
  AnimateRequest,
  VideoBytesResult,
  VideoProvider,
} from "@/providers/interfaces";
import { mockDelay, mockOutage, providerMode } from "@/providers/mode";
import { GenerationResult } from "@/providers/types";

// Veo 3.1 (image to video) under the same money rules as the other paid calls.
// It is a long-running operation: the create is the paid request — marked by
// `beforeCall` right before it, bounded, never retried (a retry after a
// timeout could start a second render); the polls and the download are free
// and tolerate a blip. A render that fails or outlives the deadline throws
// without an HTTP status, so it counts at its estimate (it may be charged); a
// clip Google's safety filter blocked throws a refusal with a status, so it
// counts nothing ("You will not be charged if your video is blocked",
// ai.google.dev/gemini-api/docs/veo, 2026-10-06).

const CREATE_TIMEOUT_MS = 120_000;
const POLL_MS = 10_000;
// Veo takes 11 s to 6 min (the docs); the deadline stays under the direct-spend
// row's 15 min lease.
export const VEO_POLL_DEADLINE_MS = 10 * 60_000;
const POLL_TOLERANCE = 3;
const DOWNLOAD_ATTEMPTS = 3;

// The pixel size each resolution renders at (Veo keeps the clip 2 days, so it
// is downloaded and stored at once).
const SIZES: Record<
  VideoResolution,
  { portrait: [number, number]; landscape: [number, number] }
> = {
  "720p": { portrait: [720, 1280], landscape: [1280, 720] },
  "1080p": { portrait: [1080, 1920], landscape: [1920, 1080] },
};

// A refusal Google answered (nothing generated, nothing charged): it carries a
// status, so the queue and the spend row count it at $0 and never retry it.
export class VideoRefused extends Error {
  readonly name = "VideoRefused";
  readonly status = 422;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockResult(model: string): GenerationResult {
  return GenerationResult.parse({
    assets: [
      {
        id: "google-animate-mock",
        url: `https://stub.local/google/animate-${randomUUID()}.mp4`,
        mime: "video/mp4",
      },
    ],
    provider: "google",
    model,
  });
}

// The model, resolution and length a request runs: refused (never swapped)
// when Kiln does not offer the model or the model does not render that length.
function vetted(input: AnimateRequest) {
  const entry = assertModel(
    { provider: "google", model: input.model.model },
    "video",
  );
  const resolution = input.model.resolution ?? DEFAULT_VIDEO_RESOLUTION;
  const lengths = entry.seconds?.[resolution] ?? [];
  if (!lengths.includes(input.durationSec)) {
    throw new ModelRefused(
      `${entry.label} renders ${lengths.join(", ")} s at ${resolution}, not ${input.durationSec} s.`,
    );
  }
  return { entry, resolution, seconds: input.durationSec };
}

async function download(video: {
  uri?: string;
  videoBytes?: string;
  mimeType?: string;
}): Promise<Uint8Array> {
  if (video.videoBytes)
    return new Uint8Array(Buffer.from(video.videoBytes, "base64"));
  if (!video.uri) throw new Error("Veo returned no video file");
  let last: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(video.uri, {
        headers: { "x-goog-api-key": googleApiKey() },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (error) {
      last = error;
      if (attempt < DOWNLOAD_ATTEMPTS) await sleep(2_000 * attempt);
    }
  }
  throw new Error(
    `The rendered video could not be downloaded (${errorMessage(last)}); it was paid.`,
  );
}

async function animateBytes(
  input: AnimateRequest,
  options?: { beforeCall?: () => Promise<void> },
): Promise<VideoBytesResult> {
  const { entry, resolution, seconds } = vetted(input);
  if (!hasGoogleKey()) {
    mockOutage("google");
    if (providerMode() === "mock") await options?.beforeCall?.();
    await mockDelay();
    const standIn = await startFrameStandIn(input.startFrameAssetId);
    return { ...standIn, model: entry.id, seconds };
  }
  const landscape = input.model.aspect === "16:9";
  const [w, h] = SIZES[resolution][landscape ? "landscape" : "portrait"];
  let image: { imageBytes: string; mimeType: string } | undefined;
  if (isFetchable(input.startFrameAssetId)) {
    const frame = await fetchAsset(input.startFrameAssetId);
    const sized = await frameSizedTo(frame.bytes, w, h);
    image = { imageBytes: sized.toString("base64"), mimeType: "image/png" };
  }

  const ai = getGenAI();
  await options?.beforeCall?.();
  let op = await ai.models.generateVideos({
    model: entry.id,
    prompt: `${input.prompt} Motion: ${input.motion}.`,
    ...(image ? { image } : {}),
    config: {
      numberOfVideos: 1,
      aspectRatio: landscape ? "16:9" : "9:16",
      durationSeconds: seconds,
      resolution,
      // Image to video accepts only "allow_adult".
      ...(image ? { personGeneration: "allow_adult" } : {}),
      ...(input.negative ? { negativePrompt: input.negative } : {}),
      httpOptions: { timeout: CREATE_TIMEOUT_MS },
    },
  });

  const deadline = Date.now() + VEO_POLL_DEADLINE_MS;
  let pollErrors = 0;
  while (!op.done) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Veo did not finish within ${VEO_POLL_DEADLINE_MS / 60_000} minutes; the render may still be charged.`,
      );
    }
    await sleep(POLL_MS);
    try {
      op = await ai.operations.getVideosOperation({ operation: op });
      pollErrors = 0;
    } catch (error) {
      pollErrors += 1;
      if (pollErrors >= POLL_TOLERANCE) {
        // Rethrown without a status: the render's outcome is unknown.
        throw new Error(
          `Lost track of the Veo render (${errorMessage(error)}); it may still be charged.`,
        );
      }
    }
  }
  if (op.error) {
    const message = (op.error as { message?: unknown }).message;
    throw new Error(
      `Veo could not render the video (${typeof message === "string" ? message : "no reason given"}); it may still be charged.`,
    );
  }
  const response = op.response;
  const video = response?.generatedVideos?.[0]?.video;
  if (!video) {
    if ((response?.raiMediaFilteredCount ?? 0) > 0) {
      const reasons = response?.raiMediaFilteredReasons?.join("; ");
      throw new VideoRefused(
        `Google's safety filter blocked this video (not charged)${reasons ? `: ${reasons}` : ""}.`,
      );
    }
    throw new Error("Veo returned no video; it may still be charged.");
  }
  return {
    bytes: await download(video),
    mime: video.mimeType ?? "video/mp4",
    model: entry.id,
    seconds,
  };
}

export const googleVideoProvider: VideoProvider = {
  id: "google",
  animateBytes,
  async animate(input, options) {
    const { entry } = vetted(input);
    if (!hasGoogleKey()) {
      await mockDelay();
      return mockResult(entry.id);
    }
    const clip = await animateBytes(input, options);
    const url = await storeAsset(clip.bytes, clip.mime, "videos");
    return GenerationResult.parse({
      assets: [{ id: randomUUID(), url, mime: clip.mime }],
      provider: "google",
      model: clip.model,
    });
  },
};

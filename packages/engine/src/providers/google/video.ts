import { randomUUID } from "node:crypto";
import type { Interactions } from "@google/genai";
import type { GenerationUsage } from "@/domain/generation-cost";
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

// Gemini Omni Flash (image to video) through the Interactions API, under the
// same money rules as the other paid calls. The create is the paid request:
// marked by `beforeCall` right before it, bounded, never retried (the
// Interactions client retries twice unless told not to; a retry after a
// timeout could start a second render). It runs in the background, which
// also keeps the SDK from continuing it in new interactions, and which
// Google requires stored, so the polls and the download are free and tolerate
// a blip, and Kiln deletes the stored interaction and clip once it has the
// clip. A render that fails after it rendered, or outlives the deadline,
// throws without an HTTP status, so it counts at its estimate (it may be
// charged). Checked on 2026-10-31: a 5 s 720p clip took 35 s and billed
// 28,960 video tokens (5,792 a second), 1,233 in and 352 of thinking.

type Interaction = Interactions.Interaction;

const CREATE_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 30_000;
const POLL_MS = 10_000;
// The deadline stays under the direct-spend row's 15 min lease.
export const VIDEO_POLL_DEADLINE_MS = 10 * 60_000;
const POLL_TOLERANCE = 3;
const DOWNLOAD_ATTEMPTS = 3;
const ONCE = { maxRetries: 0 };

// The pixel size each resolution renders at, for the start frame.
const SIZES: Record<
  VideoResolution,
  { portrait: [number, number]; landscape: [number, number] }
> = {
  "720p": { portrait: [720, 1280], landscape: [1280, 720] },
  "1080p": { portrait: [1080, 1920], landscape: [1920, 1080] },
};

// A refusal Google answered (no video made): it carries a status, so the queue
// and the spend row count it at $0 and never retry it.
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
  if (lengths.length === 0) {
    throw new ModelRefused(`${entry.label} does not render ${resolution}.`);
  }
  if (!lengths.includes(input.durationSec)) {
    throw new ModelRefused(
      `${entry.label} renders ${lengths.join(", ")} s at ${resolution}, not ${input.durationSec} s.`,
    );
  }
  return { entry, resolution, seconds: input.durationSec };
}

const tokensOf = (
  list: { modality?: string; tokens?: number }[] | undefined,
  modality: string,
) => list?.find((m) => m.modality === modality)?.tokens ?? 0;

// What the render used, as Kiln prices it: the video it made is the main
// output; its thinking and any text bill as text.
export function omniUsage(
  usage: Interaction["usage"],
): GenerationUsage | undefined {
  if (!usage) return undefined;
  const inputText = tokensOf(usage.input_tokens_by_modality, "text");
  const video = tokensOf(usage.output_tokens_by_modality, "video");
  return {
    inputTextTokens: inputText,
    inputImageTokens: Math.max(0, (usage.total_input_tokens ?? 0) - inputText),
    outputTokens: video,
    outputTextTokens:
      Math.max(0, (usage.total_output_tokens ?? 0) - video) +
      (usage.total_thought_tokens ?? 0),
  };
}

async function download(video: {
  uri?: string;
  data?: string;
}): Promise<Uint8Array> {
  if (video.data) return new Uint8Array(Buffer.from(video.data, "base64"));
  if (!video.uri) throw new Error("Gemini Omni returned no video file");
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

// Nothing of the render stays at Google once Kiln has the clip: the stored
// interaction and the clip's file (kept 48 hours otherwise). Free, and a
// failure here costs nothing, so it is never in the way.
async function forget(id: string, uri?: string): Promise<void> {
  const ai = getGenAI();
  await ai.interactions.delete(id, {}, ONCE).catch(() => {});
  const file = uri ? /\/(files\/[^/:?]+)/.exec(uri)?.[1] : undefined;
  if (file) await ai.files.delete({ name: file }).catch(() => {});
}

async function render(
  request: Interactions.InteractionCreateParams.CreateModelInteractionParamsNonStreaming,
  beforeCall?: () => Promise<void>,
): Promise<Interaction> {
  const ai = getGenAI();
  await beforeCall?.();
  let it = await ai.interactions.create(request, {
    ...ONCE,
    timeout: CREATE_TIMEOUT_MS,
  });
  const deadline = Date.now() + VIDEO_POLL_DEADLINE_MS;
  let pollErrors = 0;
  while (it.status === "in_progress") {
    if (Date.now() >= deadline) {
      await ai.interactions.cancel(it.id, {}, ONCE).catch(() => {});
      throw new Error(
        `Gemini Omni did not finish within ${VIDEO_POLL_DEADLINE_MS / 60_000} minutes; the render may still be charged.`,
      );
    }
    await sleep(POLL_MS);
    try {
      it = await ai.interactions.get(
        it.id,
        {},
        { ...ONCE, timeout: POLL_TIMEOUT_MS },
      );
      pollErrors = 0;
    } catch (error) {
      pollErrors += 1;
      if (pollErrors >= POLL_TOLERANCE) {
        // Rethrown without a status: the render's outcome is unknown.
        throw new Error(
          `Lost track of the Gemini Omni render (${errorMessage(error)}); it may still be charged.`,
        );
      }
    }
  }
  return it;
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
  const frame: Interactions.ImageContent[] = [];
  if (isFetchable(input.startFrameAssetId)) {
    const bytes = (await fetchAsset(input.startFrameAssetId)).bytes;
    const sized = await frameSizedTo(bytes, w, h);
    frame.push({
      type: "image",
      data: sized.toString("base64"),
      mime_type: "image/png",
    });
  }
  // Omni has no negative prompt and adds sound: what to avoid (speech and
  // music among it) is said in the prompt.
  const text = [
    input.prompt,
    `Motion: ${input.motion}.`,
    input.negative ? `Avoid: ${input.negative}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const it = await render(
    {
      model: entry.id,
      input: [...frame, { type: "text", text }],
      response_modalities: ["video"],
      response_format: {
        type: "video",
        aspect_ratio: landscape ? "16:9" : "9:16",
        resolution,
        duration: `${seconds}s`,
        delivery: "uri",
      },
      background: true,
    },
    options?.beforeCall,
  );
  const usage = omniUsage(it.usage);
  const video = it.output_video;
  if (it.status !== "completed" || !video) {
    await forget(it.id);
    if ((usage?.outputTokens ?? 0) > 0) {
      throw new Error(
        `Gemini Omni stopped (${it.status}) after rendering; it may still be charged.`,
      );
    }
    const said = it.output_text?.trim();
    if (it.status === "completed") {
      throw new VideoRefused(
        `Gemini Omni made no video${said ? `: ${said}` : ""}. No video was billed.`,
      );
    }
    // Answered with nothing rendered: a retry, or the route's next model, may pass.
    throw Object.assign(
      new Error(`Gemini Omni could not render the video (${it.status}).`),
      { status: 502 },
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await download(video);
  } finally {
    await forget(it.id, video.uri);
  }
  return {
    bytes,
    mime: video.mime_type ?? "video/mp4",
    model: entry.id,
    seconds,
    ...(usage ? { usage } : {}),
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
      ...(clip.usage ? { usage: clip.usage } : {}),
    });
  },
};

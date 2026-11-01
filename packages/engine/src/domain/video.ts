import { z } from "zod";
import {
  DEFAULT_MAKER_MODELS,
  DEFAULT_VIDEO_RESOLUTION,
  modelEntry,
  type VideoResolution,
} from "@/domain/model-defaults";

// A video slot animates a scene the maker already approved (never a new
// image): how the camera moves, how long it runs and its orientation are the
// maker's choice; the product stays exactly as in the start frame.

export const VideoMotion = z.enum(["push-in", "pan", "light"]);
export type VideoMotion = z.infer<typeof VideoMotion>;

export const VIDEO_MOTIONS: Record<
  VideoMotion,
  { label: string; text: string }
> = {
  "push-in": {
    label: "Subtle push-in",
    text: "a subtle, slow push-in toward the product",
  },
  pan: {
    label: "Slow pan",
    text: "a slow lateral pan across the scene, the product staying in frame",
  },
  light: {
    label: "Static, light change",
    text: "a static camera; soft natural light slowly shifting across the scene",
  },
};

// A clip's length in seconds; which lengths are valid depends on the model and
// its resolution (the catalog) and on the destination.
export const VideoSeconds = z.number().int().min(1).max(60);
export type VideoSeconds = z.infer<typeof VideoSeconds>;

export const VideoOrientation = z.enum(["portrait", "landscape"]);
export type VideoOrientation = z.infer<typeof VideoOrientation>;

// What a plan's video slot keeps: the slot whose approved scene starts it, the
// motion, the length and the orientation. Each is optional; videoSettings
// fills the defaults.
export const VideoChoice = z.object({
  from: z.string().min(1).optional(),
  motion: VideoMotion.optional(),
  seconds: VideoSeconds.optional(),
  orientation: VideoOrientation.optional(),
});
export type VideoChoice = z.infer<typeof VideoChoice>;

// The lengths the model renders at its resolution that the destination
// accepts (Gemini Omni on Etsy, 5-15 s: 5 to 10). When none fits, the
// model's length nearest to the destination's range.
export function videoSecondsFor(
  rules?: { minSec: number; maxSec: number },
  model: {
    provider: string;
    model: string;
    resolution?: VideoResolution;
  } = DEFAULT_MAKER_MODELS.video,
): VideoSeconds[] {
  const resolution = model.resolution ?? DEFAULT_VIDEO_RESOLUTION;
  const all = [...(modelEntry(model)?.seconds?.[resolution] ?? [8])];
  if (!rules) return all;
  const ok = all.filter((s) => s >= rules.minSec && s <= rules.maxSec);
  if (ok.length > 0) return ok;
  const distance = (s: number) =>
    s < rules.minSec ? rules.minSec - s : s - rules.maxSec;
  return [all.reduce((a, b) => (distance(b) < distance(a) ? b : a))];
}

// A wanted length on the allowed ones: kept when allowed, else 8 when allowed,
// else the nearest.
export function snapSeconds(
  wanted: number | undefined,
  allowed: VideoSeconds[],
): VideoSeconds {
  if (wanted !== undefined && allowed.includes(wanted)) return wanted;
  if (allowed.includes(8)) return 8;
  const target = wanted ?? 8;
  return allowed.reduce((a, b) =>
    Math.abs(b - target) < Math.abs(a - target) ? b : a,
  );
}

export function aspectOf(orientation: VideoOrientation): "9:16" | "16:9" {
  return orientation === "landscape" ? "16:9" : "9:16";
}

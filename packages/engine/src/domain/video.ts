import { z } from "zod";
import { soraSeconds } from "@/domain/generation-cost";

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

export const VideoSeconds = z.union([
  z.literal(4),
  z.literal(8),
  z.literal(12),
]);
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

// The lengths a destination accepts among the ones Sora renders (Etsy wants
// 5-15 s: 8 or 12).
export function videoSecondsFor(rules?: {
  minSec: number;
  maxSec: number;
}): VideoSeconds[] {
  const all: VideoSeconds[] = [4, 8, 12];
  const ok = rules
    ? all.filter((s) => s >= rules.minSec && s <= rules.maxSec)
    : all;
  return ok.length > 0 ? ok : [soraSeconds(rules?.minSec ?? 8)];
}

export function aspectOf(orientation: VideoOrientation): "9:16" | "16:9" {
  return orientation === "landscape" ? "16:9" : "9:16";
}

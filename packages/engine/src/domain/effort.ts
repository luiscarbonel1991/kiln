import { z } from "zod";
import { modelEntry } from "@/domain/model-defaults";

// How hard a text model thinks (Luis, 2026-10-31: "con más esfuerzo, con menos
// esfuerzo"), on Kiln's scale, which is OpenAI's reasoning effort. Each
// catalog text model offers some of the levels (Google's thinking: low,
// medium, high); a level a model lacks runs at the highest it has below it,
// and the record keeps the level it ran at. More effort buys more thinking, so
// a bigger output allowance and more time, both counted before spending. Low
// is what Kiln always sent, so nothing changes until the maker raises it.

export const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof Effort>;

export const DEFAULT_EFFORT: Effort = "low";

export const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-high",
  max: "Max",
};

// The level a model runs at when asked for `asked`.
export function effortOn(
  model: { provider: string; model: string },
  asked: Effort,
): Effort {
  const offered = modelEntry(model)?.efforts;
  if (!offered?.length) return asked;
  for (let i = Effort.options.indexOf(asked); i >= 0; i--) {
    if (offered.includes(Effort.options[i])) return Effort.options[i];
  }
  return offered[0];
}

// The most a model thinks, for a note beside a level it cannot reach.
export function topEffort(model: {
  provider: string;
  model: string;
}): Effort | null {
  return modelEntry(model)?.efforts?.at(-1) ?? null;
}

// Google's thinking level for a level a Gemini model offers.
export function googleThinking(effort: Effort): "low" | "medium" | "high" {
  return effort === "xhigh" || effort === "max" ? "high" : effort;
}

// What a level multiplies: a text call's output allowance (thinking is billed
// as output) and its time.
const SCALE: Record<Effort, number> = {
  low: 1,
  medium: 2,
  high: 4,
  xhigh: 8,
  max: 16,
};
export const effortScale = (effort: Effort): number => SCALE[effort];

// A chat turn's time at a level; one text call gets a quarter of it (a
// minute at low, as before).
const TURN_MINUTES: Record<Effort, number> = {
  low: 4,
  medium: 6,
  high: 10,
  xhigh: 15,
  max: 20,
};
export const turnMs = (effort: Effort): number => TURN_MINUTES[effort] * 60_000;
export const textTimeoutMs = (effort: Effort): number =>
  TURN_MINUTES[effort] * 15_000;

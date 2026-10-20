import type { Card } from "@/domain/card";
import type { PlanSlot, SlotView } from "@/domain/plan";
import type { Product } from "@/domain/product";
import {
  effectiveKnobs,
  KNOBS,
  type KnobKey,
  knobStops,
  knobSummary,
  type Stop,
} from "@/domain/scene-knobs";

// What the board's Tune shows for one scene slot: its knobs with the stop each
// applies (the maker's, or Kiln's pick and why), whether they can be turned
// now, what keeps them from reaching the prompt, and what the model reads.

const DIRECTION = ["scene", "composition", "lighting"] as const;
type Direction = (typeof DIRECTION)[number];

export interface TuneKnob {
  key: KnobKey;
  label: string;
  stop: string;
  // The maker set it (else it is the slot's default or Kiln's pick).
  chosen: boolean;
  // Why Kiln picked this stop for the product.
  why?: string;
  stops: { key: string; label: string; hint: string }[];
}

export interface TuneView {
  summary: string;
  knobs: TuneKnob[];
  // Why the knobs cannot be turned now, or null.
  locked: string | null;
  // What keeps the knobs from the prompt: the card's own prompt, or a
  // direction field written in the editor.
  inert: { prompt: boolean; fields: Direction[] };
  // The direction the model reads now; null before the reference exists.
  reads: Record<Direction, string> | null;
}

export function tuneView(input: {
  slot: PlanSlot;
  card?: Card;
  view: SlotView;
  product: Product;
}): TuneView | null {
  const { slot, card, view, product } = input;
  if (slot.fill !== "scene" || !slot.knobs) return null;
  const knobs = effectiveKnobs(slot.knobs, product, slot.tuned);
  const locked =
    view.inBatch || view.state === "generating" || view.state === "retrying"
      ? "In the queue: tune it when it is done."
      : view.state === "approved" || view.state === "delivered"
        ? "Approved: undo the approval to tune it."
        : null;
  return {
    summary: knobSummary(knobs),
    knobs: knobs.offered.map((key) => {
      const stops = KNOBS[key].stops as Record<string, Stop>;
      return {
        key,
        label: KNOBS[key].label,
        stop: knobs.stops[key] ?? "any",
        chosen: knobs.chosen.includes(key),
        ...(knobs.why[key] ? { why: knobs.why[key] } : {}),
        stops: (knobStops(key) as string[]).map((s) => ({
          key: s,
          label: stops[s].label,
          hint: stops[s].hint,
        })),
      };
    }),
    locked,
    inert: {
      prompt: (card?.promptOverride ?? "").trim() !== "",
      fields: card
        ? DIRECTION.filter((k) => card.fields[k].source === "local")
        : [],
    },
    reads: card
      ? {
          scene: card.fields.scene.value,
          composition: card.fields.composition.value,
          lighting: card.fields.lighting.value,
        }
      : null,
  };
}

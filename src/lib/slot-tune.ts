import type { Card } from "@/domain/card";
import { type Route, takeEstimate } from "@/domain/model-routing";
import type { PlanSlot, SlotView } from "@/domain/plan";
import type { JobView } from "@/domain/queue";
import {
  effectiveKnobs,
  KNOBS,
  type KnobChoice,
  type KnobKey,
  knobStops,
  knobSummary,
  REASONS,
  ReasonKey,
  reasonMove,
  type Stop,
} from "@/domain/scene-knobs";
import {
  kilnPick,
  looksDown,
  type ThreeQuarterView,
} from "@/domain/scene-reference";

// What the board's Tune shows for one scene slot: its knobs with the stop each
// applies (the maker's, or the scene's default), whether they can be turned
// now, what keeps them from reaching the prompt, and what the model reads.
// A take to review adds what may be off about it (each reason moves a knob)
// and a new take with its price, priced as the queue prices it.

const DIRECTION = ["scene", "composition", "lighting"] as const;
type Direction = (typeof DIRECTION)[number];

export interface TuneKnob {
  key: KnobKey;
  label: string;
  stop: string;
  // The maker set it (else it is Kiln's pick or the scene's default).
  chosen: boolean;
  // Kiln set it over the scene's default (a little above, once the view
  // from above exists).
  picked: boolean;
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
  // What may be off about the take to review, each with the knob it moves.
  reasons: { key: ReasonKey; label: string; move: KnobChoice }[];
  // One more take of this scene (it replaces the one shown), with its price
  // in USD; null unless there is a take to review and nothing queued.
  take: { typical: number; max: number } | null;
  // Why the last take failed, even when an earlier one still shows.
  error: string | null;
  // Where the scene stands: its own place (the maker's) or null for the
  // product's places in order, the places to pick from, and whether picking
  // one puts a hero in its place. Null when the scene takes no place.
  place: {
    own: string | null;
    options: TunePlace[];
    putsInPlace: boolean;
  } | null;
  // The image the next take edits, when Kiln drew a view from above: that
  // view for a camera looking down, else the front. Null without one.
  startsFrom: "above" | "front" | null;
}

export interface TunePlace {
  place: string;
  // A place of use of the product, or one a market brief note suggests.
  from: "product" | "brief";
}

// A scene takes a place when its own scene names one, or when it offers a
// setting (a hero, which stands in its place once it has one).
export const takesPlace = (slot: PlanSlot) =>
  slot.knobs?.setting !== undefined || (slot.scene ?? "").includes("{use}");

export function tuneView(input: {
  slot: PlanSlot;
  card?: Card;
  view: SlotView;
  job?: JobView;
  places?: TunePlace[];
  // The project's view from above, when it applies to its reference.
  above?: ThreeQuarterView | null;
  // The scenes' route (final), its models that may run here: a take is
  // priced at the dearest model it may run on, as the queue reserves it.
  route?: Route | null;
}): TuneView | null {
  const { slot, card, view, job, places = [], above = null } = input;
  if (slot.fill !== "scene" || !slot.knobs) return null;
  const knobs = effectiveKnobs(
    slot.knobs,
    slot.tuned,
    kilnPick(slot.knobs, above),
  );
  const locked =
    view.inBatch || view.state === "generating" || view.state === "retrying"
      ? "In the queue: tune it when it is done."
      : view.state === "approved" || view.state === "delivered"
        ? "Approved: undo the approval to tune it."
        : null;
  const reviewing = view.state === "to-review" && locked === null && !!card;
  const price =
    reviewing && card
      ? takeEstimate(card.model, card.references.length, input.route)
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
        picked: knobs.picked.includes(key),
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
    reasons: reviewing
      ? ReasonKey.options.flatMap((key) => {
          const move = reasonMove(key, knobs);
          return move ? [{ key, label: REASONS[key].label, move }] : [];
        })
      : [],
    take: price,
    error:
      view.error ?? (job?.status === "failed" ? (job.error ?? null) : null),
    startsFrom: above
      ? looksDown(knobs.stops.camera)
        ? "above"
        : "front"
      : null,
    place: takesPlace(slot)
      ? {
          own: slot.place ?? null,
          options: places,
          putsInPlace: slot.knobs?.setting !== undefined,
        }
      : null,
  };
}

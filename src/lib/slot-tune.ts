import type { Card } from "@/domain/card";
import { modelEntry } from "@/domain/model-defaults";
import { type Route, takeEstimate } from "@/domain/model-routing";
import type { PlanSlot, ProjectPlan, SlotView } from "@/domain/plan";
import { projectLook } from "@/domain/plan-look";
import { colourOf, type Product } from "@/domain/product";
import {
  ORIGINAL,
  productStyles,
  resolveLook,
  styleName,
} from "@/domain/product-look";
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
  // The maker set it (else it is a kept lesson's, Kiln's pick or the
  // scene's default).
  chosen: boolean;
  // A lesson the maker kept for the family set it.
  learned: boolean;
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
  // The whole prompt the next take sends, what it must never show and how
  // many images go with the reference (DOGFOOD #42); null when unknown.
  prompt: { text: string; negative: string; images: number } | null;
  // What may be off about the take to review, each with the knob it moves.
  reasons: { key: ReasonKey; label: string; move: KnobChoice }[];
  // One more take of this scene (it replaces the one shown), with its price
  // in USD; null unless there is a take to review and nothing queued.
  take: { typical: number; max: number } | null;
  // Why the scene's provider cannot take a paid call now (no key, a rejected
  // key), shown in place of the take; else null.
  blocked: string | null;
  // A test take (DOGFOOD #53): the scene at its model's low quality, priced;
  // null when its model has no low quality, or it cannot run now.
  testTake: { typical: number; max: number } | null;
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
  // The colour and style the scene shows (ROADMAP P2-9); null when the
  // product shows in one look only.
  look: TuneLook | null;
}

export interface TuneLookOption {
  // null: the project's.
  key: string | null;
  label: string;
  face?: string;
  // Why it cannot be picked; absent when it can.
  refused?: string;
}

export interface TuneLook {
  colours: TuneLookOption[];
  // Empty for a product with one design.
  styles: TuneLookOption[];
  // The scene's own colour and style, null where it shows the project's.
  colour: string | null;
  style: string | null;
  // Why the scene cannot take a look of its own, else null.
  refused: string | null;
}

// The looks a scene can show: the project's, or one of the product's colours
// and styles. A version shows its source's, so it offers none.
export function tuneLook(
  product: Product,
  plan: ProjectPlan,
  slot: PlanSlot,
): TuneLook | null {
  if (slot.fill !== "scene" || slot.versionOf) return null;
  const styles = productStyles(product);
  if (product.colours.length < 2 && styles.length === 0) return null;
  const project = projectLook(plan, product);
  const own = resolveLook(product, slot.look);
  return {
    colours: [
      {
        key: null,
        label: `The project's (${colourOf(product, project.colour).name})`,
      },
      ...product.colours.map((c) => ({
        key: c.key,
        label: c.name,
        face: c.face,
        ...(c.inStock ? {} : { refused: `${c.name} is out of stock` }),
      })),
    ],
    styles:
      styles.length === 0
        ? []
        : [
            {
              key: null,
              label: `The project's (${styleName(product, project.style)})`,
            },
            { key: ORIGINAL, label: styleName(product, null) },
            ...styles.map((st) => ({ key: st.key, label: st.name })),
          ],
    colour:
      slot.look?.colour && own.colour === slot.look.colour ? own.colour : null,
    style: slot.look?.style ? (own.style ?? ORIGINAL) : null,
    refused:
      product.source.kind === "vector"
        ? null
        : "Kiln draws other colours and styles from a design file; this product has none.",
  };
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
  // The scene's colour and style (tuneLook).
  look?: TuneLook | null;
  // Why its provider cannot take a paid call now (providerBlock).
  blocked?: string | null;
  // What the next take sends (scenePrompts).
  prompt?: { prompt: string; negative: string; images: number } | null;
}): TuneView | null {
  const { slot, card, view, job, places = [], above = null } = input;
  if (slot.fill !== "scene" || !slot.knobs) return null;
  const knobs = effectiveKnobs(
    slot.knobs,
    slot.tuned,
    kilnPick(slot.knobs, above),
    slot.learned,
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
        learned: knobs.learned.includes(key),
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
    take: input.blocked ? null : price,
    testTake:
      card &&
      locked === null &&
      !input.blocked &&
      modelEntry(card.model)?.qualities?.includes("low")
        ? takeEstimate(
            { ...card.model, quality: "low" },
            card.references.length,
            null,
          )
        : null,
    blocked: reviewing ? (input.blocked ?? null) : null,
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
    look: input.look ?? null,
    prompt: input.prompt
      ? {
          text: input.prompt.prompt,
          negative: input.prompt.negative,
          images: input.prompt.images,
        }
      : null,
  };
}

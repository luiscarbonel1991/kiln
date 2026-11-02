import { colourTextWarning } from "@/domain/colour-text";
import {
  type CardLike,
  type JobLike,
  type PlanSlot,
  type ProjectPlan,
  type SlotState,
  type SlotView,
  slotCardId,
  slotState,
} from "@/domain/plan";
import { slotLook } from "@/domain/plan-look";
import type { Product } from "@/domain/product";
import { lookLabel, productStyles } from "@/domain/product-look";
import type { TakeCheck } from "@/domain/qc";
import type { SlotFill } from "@/domain/shot-list";

// Each frame of a project as an agent reads it (the HTTP API's frames, `kiln
// frames`): where it is, its state, the take it shows now and the one
// approved. `output` is what an approval approves, so a caller that checks a
// take passes it back with the approval, and a newer take is never approved
// unseen.

export interface FrameView {
  // The destination and the slot ("etsy.hero"): the frame's name in the CLI.
  frame: string;
  destinationId: string;
  slotKey: string;
  label: string;
  fill: SlotFill;
  aspect: string | null;
  state: SlotState;
  failed: boolean;
  error?: string;
  // A finished take of a scene or video, the maker's photo, or the approved
  // take a shared frame repeats; null for an exact frame (drawn at export)
  // and while a take is on its way.
  output: string | null;
  approvedOutput: string | null;
  // A finished take waiting for a decision (never a test take).
  approvable: boolean;
  // The take is a test take: low quality, a check of the direction.
  test?: boolean;
  // The frame this one re-frames (a version) or repeats (a shared frame).
  versionOf?: string;
  // After a move down its route (Settings → Models): the model its latest
  // take ran on, the first model it left and why.
  ranOn?: { label: string; from: string; reason: string };
  // A scene's colour and style, for a product in more than one look, and
  // what in the product's text contradicts that colour (colourTextWarning).
  look?: { colour: string; style?: string; name: string; textWarning?: string };
  // What Kiln read in a scene's shown take (domain TakeCheck): passed,
  // failed or unchecked, what failed, what it noticed, and the size the
  // scene asked for, which nothing measured. Null for a take never checked;
  // absent without a scene take.
  check?: FrameCheck | null;
}

export type FrameCheck = Pick<TakeCheck, "status" | "problems" | "notes"> & {
  scale?: string;
  unchecked?: string;
};

function frameCheck(check: TakeCheck | null): FrameCheck | null {
  if (!check) return null;
  return {
    status: check.status,
    problems: check.problems,
    notes: check.notes,
    ...(check.scale ? { scale: check.scale } : {}),
    ...(check.unchecked ? { unchecked: check.unchecked } : {}),
  };
}

function textWarningOf(
  product: Product,
  colour: string,
): { textWarning?: string } {
  const warning = colourTextWarning(product, colour);
  return warning ? { textWarning: warning } : {};
}

function outputOf(
  slot: ProjectPlan["destinations"][number]["slots"][number],
  card: CardLike | undefined,
): string | null {
  if (slot.fill === "photo") return slot.photo ?? null;
  if (slot.fill === "shared") return slot.approvedOutput ?? null;
  if (slot.fill === "exact" || card?.status !== "done") return null;
  return card.outputs[0] ?? null;
}

export function frameViews(
  plan: ProjectPlan,
  cards: Record<string, CardLike>,
  jobs: Record<string, JobLike>,
  // The product the project follows: a scene names its look by it.
  product?: Product,
  // What Kiln read in each frame's shown take (null: never checked).
  checks: Record<string, TakeCheck | null> = {},
): FrameView[] {
  const looks =
    product && (product.colours.length > 1 || productStyles(product).length > 0)
      ? product
      : null;
  return plan.destinations.flatMap((d) =>
    d.slots.map((slot): FrameView => {
      const frame = slotCardId(d.destinationId, slot.key);
      const card = cards[frame];
      const view = slotState(slot, card, jobs[frame]);
      const look =
        looks && slot.fill === "scene" ? slotLook(plan, slot, looks) : null;
      const output = outputOf(slot, card);
      return {
        frame,
        destinationId: d.destinationId,
        slotKey: slot.key,
        label: slot.label,
        fill: slot.fill,
        aspect: slot.aspect ?? null,
        state: view.state,
        failed: view.failed,
        ...(view.error ? { error: view.error } : {}),
        output,
        approvedOutput: slot.approvedOutput ?? null,
        approvable: view.state === "to-review" && !view.test,
        ...(view.test ? { test: true } : {}),
        ...(slot.versionOf ? { versionOf: slot.versionOf } : {}),
        ...(jobs[frame]?.ranOn ? { ranOn: jobs[frame].ranOn } : {}),
        ...(looks && look
          ? {
              look: {
                colour: look.colour,
                ...(look.style ? { style: look.style } : {}),
                name: lookLabel(looks, look),
                ...textWarningOf(looks, look.colour),
              },
            }
          : {}),
        ...(slot.fill === "scene" && output && frame in checks
          ? { check: frameCheck(checks[frame]) }
          : {}),
      };
    }),
  );
}

// A slot with its card and state, as the board and the frames read it.
export interface FrameSlot {
  cardId: string;
  slot: PlanSlot;
  card?: CardLike;
  view: SlotView;
}

export function frameSlots(
  plan: ProjectPlan,
  cards: Record<string, CardLike>,
  jobs: Record<string, JobLike>,
): FrameSlot[] {
  return plan.destinations.flatMap((d) =>
    d.slots.map((slot) => {
      const cardId = slotCardId(d.destinationId, slot.key);
      const card = cards[cardId];
      return { cardId, slot, card, view: slotState(slot, card, jobs[cardId]) };
    }),
  );
}

// The scene frames a batch would generate (the board's Generate, the quote of
// an agent's): a card exists, nothing is queued or running for it, and it has
// no take yet (a failed one counts). A video is generated from its own slot,
// never in the scene batch; a version waits until the scene it re-frames is
// approved.
export function waitingFrames(slots: readonly FrameSlot[]): string[] {
  const byId = new Map(slots.map((s) => [s.cardId, s.slot]));
  return slots
    .filter(
      (s) =>
        s.slot.fill === "scene" &&
        s.card &&
        s.view.state === "queued" &&
        !s.view.inBatch &&
        (!s.slot.versionOf ||
          Boolean(byId.get(s.slot.versionOf)?.approvedOutput)),
    )
    .map((s) => s.cardId);
}

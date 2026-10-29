import {
  type CardLike,
  type JobLike,
  type ProjectPlan,
  type SlotState,
  slotCardId,
  slotState,
} from "@/domain/plan";
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
  // A finished take waiting for a decision.
  approvable: boolean;
  // The frame this one re-frames (a version) or repeats (a shared frame).
  versionOf?: string;
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
): FrameView[] {
  return plan.destinations.flatMap((d) =>
    d.slots.map((slot): FrameView => {
      const frame = slotCardId(d.destinationId, slot.key);
      const card = cards[frame];
      const view = slotState(slot, card, jobs[frame]);
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
        output: outputOf(slot, card),
        approvedOutput: slot.approvedOutput ?? null,
        approvable: view.state === "to-review",
        ...(slot.versionOf ? { versionOf: slot.versionOf } : {}),
      };
    }),
  );
}

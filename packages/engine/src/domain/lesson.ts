import { z } from "zod";
import type { ProjectPlan } from "@/domain/plan";
import {
  KNOBS,
  KnobKey,
  knobStops,
  REASONS,
  ReasonKey,
} from "@/domain/scene-knobs";

// What Kiln learns of a maker's taste (ROADMAP "Agents", stage 4; Phase 14):
// a lesson is proposed from what the maker did (the reasons they gave for a
// take, the knobs of the takes they approved, a 30-day read) or by an agent,
// and counts only once the maker keeps it. Lessons are per product family
// (or for every family) and read by every agent; a scene lesson also moves
// a knob, which a new project of the family starts its frame with.

export const LessonTopic = z.enum(["scenes", "listing", "designs", "general"]);
export type LessonTopic = z.infer<typeof LessonTopic>;

export const LessonStatus = z.enum(["proposed", "kept", "dismissed"]);
export type LessonStatus = z.infer<typeof LessonStatus>;

// Where it came from: the maker's own choices on the board (taste), a
// listing's numbers (read), or an agent that noticed it.
export const LessonSource = z.enum(["taste", "read", "agent"]);
export type LessonSource = z.infer<typeof LessonSource>;

// A scene lesson's move: the stop a frame of the family starts with.
export const LessonMove = z
  .object({
    destinationId: z.string().min(1),
    slotKey: z.string().min(1),
    knob: KnobKey,
    stop: z.string().min(1),
  })
  .refine(
    (m) => m.stop !== "any" && (knobStops(m.knob) as string[]).includes(m.stop),
    { message: "a lesson moves a knob to one of its stops" },
  );
export type LessonMove = z.infer<typeof LessonMove>;

// A family as lessons match it: the same family written with other
// capitals or spaces is the same family.
export const familyKey = (family: string) => family.trim().toLowerCase();

export const sceneLessonKey = (
  family: string,
  move: Pick<LessonMove, "destinationId" | "slotKey" | "knob">,
) =>
  `scene:${familyKey(family)}:${move.destinationId}.${move.slotKey}:${move.knob}`;

// One thing the maker did that says where a knob belongs: a reason given
// for a take (the stop it moved the knob to) or an approved take's stop.
export interface TasteVote {
  kind: "reason" | "approval";
  reason?: string | null;
  stop: string;
}

// Two of the maker's own choices agreeing make a proposal; one is a whim.
export const MIN_VOTES = 2;

export interface AgreedStop {
  stop: string;
  approvals: number;
  reasons: Partial<Record<ReasonKey, number>>;
}

// The stop the maker's choices agree on, newest first: the most voted with
// at least MIN_VOTES, a tie going to the latest.
export function agreedStop(votes: TasteVote[]): AgreedStop | null {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(vote.stop, (counts.get(vote.stop) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const vote of votes) {
    const n = counts.get(vote.stop) ?? 0;
    if (n >= MIN_VOTES && (best === null || n > (counts.get(best) ?? 0))) {
      best = vote.stop;
    }
  }
  if (best === null) return null;
  const reasons: Partial<Record<ReasonKey, number>> = {};
  let approvals = 0;
  for (const vote of votes) {
    if (vote.stop !== best) continue;
    if (vote.kind === "approval") approvals++;
    const reason = ReasonKey.safeParse(vote.reason);
    if (vote.kind === "reason" && reason.success) {
      reasons[reason.data] = (reasons[reason.data] ?? 0) + 1;
    }
  }
  return { stop: best, approvals, reasons };
}

const times = (n: number) =>
  n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

// A scene lesson in the maker's words: "Kitchen, Etsy's Hero: the camera A
// little above (approved twice with it; "Can't see its top" once)."
export function sceneLessonText(input: {
  family: string;
  destination: string;
  slot: string;
  knob: KnobKey;
  agreed: AgreedStop;
}): string {
  const { family, destination, slot, knob, agreed } = input;
  const stop =
    (KNOBS[knob].stops as Record<string, { label: string }>)[agreed.stop]
      ?.label ?? agreed.stop;
  const why = [
    agreed.approvals > 0 ? `approved ${times(agreed.approvals)} with it` : null,
    ...Object.entries(agreed.reasons).map(
      ([reason, n]) => `"${REASONS[reason as ReasonKey].label}" ${times(n)}`,
    ),
  ]
    .filter(Boolean)
    .join("; ");
  const at = stop.charAt(0).toLowerCase() + stop.slice(1);
  return `${family.trim()}, ${destination}'s ${slot}: the ${KNOBS[knob].label.toLowerCase()} ${at}${why ? ` (${why})` : ""}.`;
}

// A new plan's frames start with the stops the maker's kept lessons set for
// the family, where the scene offers the knob; the maker's own choices still
// win (effectiveKnobs).
export function withLearned(
  plan: ProjectPlan,
  moves: LessonMove[],
): ProjectPlan {
  if (moves.length === 0) return plan;
  return {
    ...plan,
    destinations: plan.destinations.map((d) => ({
      ...d,
      slots: d.slots.map((slot) => {
        if (slot.fill !== "scene" || !slot.knobs) return slot;
        const mine = moves.filter(
          (m) =>
            m.destinationId === d.destinationId &&
            m.slotKey === slot.key &&
            slot.knobs?.[m.knob] !== undefined,
        );
        if (mine.length === 0) return slot;
        return {
          ...slot,
          learned: {
            ...slot.learned,
            ...Object.fromEntries(mine.map((m) => [m.knob, m.stop])),
          },
        };
      }),
    })),
  };
}

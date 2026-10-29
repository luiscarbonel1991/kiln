import { type ProjectPlan, slotCardId } from "@/domain/plan";

// What a project's photo work cost (ROADMAP #68: the number a business prices
// into a product): per frame, every take it took (re-rolls included); per
// destination and for the project, the total and the cost per approved frame.
// An exact frame, the maker's photo and a shared frame cost nothing; a frame
// is approved when its current output is. Spend follows the budget's rule
// (live jobs, a job's measured cost, else its estimate when the call went
// out), measured by the caller.

export interface CardSpend {
  spentMicros: number;
  // Finished generations (each one a take), the rejected ones included.
  takes: number;
}

export interface FrameCost {
  slotKey: string;
  label: string;
  spentMicros: number;
  takes: number;
  approved: boolean;
}

export interface CostSummary {
  spentMicros: number;
  takes: number;
  approved: number;
  // Spent over the frames approved; null before the first approval.
  perApprovedMicros: number | null;
}

export interface DestinationCost extends CostSummary {
  destinationId: string;
  frames: FrameCost[];
}

export interface ProjectCost extends CostSummary {
  destinations: DestinationCost[];
  // Spend that belongs to no frame of the plan: text calls (the listing
  // text), a card the plan no longer has.
  otherMicros: number;
}

const perApproved = (spent: number, approved: number) =>
  approved > 0 ? Math.round(spent / approved) : null;

export function projectCost(
  plan: ProjectPlan,
  spend: Map<string, CardSpend>,
  otherMicros = 0,
): ProjectCost {
  const counted = new Set<string>();
  const destinations = plan.destinations.map((d): DestinationCost => {
    const frames = d.slots
      .filter((s) => !s.off && (s.fill === "scene" || s.fill === "video"))
      .map((s): FrameCost => {
        const id = slotCardId(d.destinationId, s.key);
        counted.add(id);
        const card = spend.get(id);
        return {
          slotKey: s.key,
          label: s.label,
          spentMicros: card?.spentMicros ?? 0,
          takes: card?.takes ?? 0,
          approved: Boolean(s.approvedOutput),
        };
      });
    const spent = frames.reduce((t, f) => t + f.spentMicros, 0);
    const approved = frames.filter((f) => f.approved).length;
    return {
      destinationId: d.destinationId,
      frames,
      spentMicros: spent,
      takes: frames.reduce((t, f) => t + f.takes, 0),
      approved,
      perApprovedMicros: perApproved(spent, approved),
    };
  });
  // A card switched off or dropped from the plan still spent what it spent.
  let other = otherMicros;
  let otherTakes = 0;
  for (const [id, card] of spend) {
    if (counted.has(id)) continue;
    other += card.spentMicros;
    otherTakes += card.takes;
  }
  const framesSpent = destinations.reduce((t, d) => t + d.spentMicros, 0);
  const approved = destinations.reduce((t, d) => t + d.approved, 0);
  const spent = framesSpent + other;
  return {
    destinations,
    otherMicros: other,
    spentMicros: spent,
    takes: destinations.reduce((t, d) => t + d.takes, 0) + otherTakes,
    approved,
    perApprovedMicros: perApproved(spent, approved),
  };
}

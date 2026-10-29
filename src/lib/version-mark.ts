import { type PlanSlot, type ProjectPlan, versionSource } from "@/domain/plan";
import { CATALOG } from "@/lib/recipes";

// Where a version or a shared frame comes from, in a line: "same scene as
// Etsy · In-use mockup", "re-frames Hook · waits for its approval".
// `waits: false` leaves out the wait (a plan before Start, where nothing is
// approved yet).
export function versionMark(
  plan: ProjectPlan,
  slot: PlanSlot,
  { waits: showWait = true }: { waits?: boolean } = {},
): string | undefined {
  if (!slot.versionOf) return undefined;
  const source = versionSource(plan, slot);
  if (!source) return undefined;
  const name =
    CATALOG.destinations.find((d) => d.id === source.destinationId)?.name ??
    source.destinationId;
  const own = plan.destinations.some(
    (d) => d.destinationId === source.destinationId && d.slots.includes(slot),
  );
  const what = own ? source.slot.label : `${name} · ${source.slot.label}`;
  const waits =
    showWait && !source.slot.approvedOutput ? " · waits for its approval" : "";
  return slot.fill === "shared"
    ? `same scene as ${what}${waits}`
    : `re-frames ${what}${waits}`;
}

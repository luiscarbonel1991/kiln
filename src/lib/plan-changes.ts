import type { PlanChange } from "@/domain/plan";
import { CATALOG } from "@/lib/recipes";

const destinationName = (id: string) =>
  CATALOG.destinations.find((d) => d.id === id)?.name ?? id;

// What an update would do to the plan, a line per destination ("Etsy: adds
// Colour options; removes How to personalize."), then the deliveries it
// clears.
export function planChangeLines(
  changes: PlanChange[],
  redeliver: string[],
): string[] {
  const ids = [...new Set(changes.map((c) => c.destinationId))];
  const lines = ids.map((id) => {
    const words = (["adds", "removes"] as const).flatMap((change) => {
      const labels = changes
        .filter((c) => c.destinationId === id && c.change === change)
        .map((c) => c.label);
      return labels.length > 0 ? [`${change} ${labels.join(", ")}`] : [];
    });
    return `${destinationName(id)}: ${words.join("; ")}.`;
  });
  return [
    ...lines,
    ...redeliver.map(
      (id) =>
        `${destinationName(id)} was delivered: its photos renumber, so deliver it again.`,
    ),
  ];
}

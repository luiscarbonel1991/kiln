import type { ProjectPlan, SlotRef } from "@/domain/plan";
import { slotCardId } from "@/domain/plan";
import { slotCards } from "@/lib/project-start";
import { setSlotTuning } from "@/server/project-repository";

// Tune one scene slot (free): the plan keeps the change and the slot's card
// is written again from it, on its own destination only. The board's Tune
// and the reject_frame tool both tune through here.
export function retuneSlot(
  projectId: string,
  ref: SlotRef,
  tune: (plan: ProjectPlan) => ProjectPlan,
) {
  const cardId = slotCardId(ref.destinationId, ref.slotKey);
  return setSlotTuning(projectId, ref, tune, ({ plan, master, product }) =>
    slotCards(
      {
        ...plan,
        destinations: plan.destinations.filter(
          (d) => d.destinationId === ref.destinationId,
        ),
      },
      master,
      product,
    ).find((card) => card.id === cardId),
  );
}

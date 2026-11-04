import type { Card } from "@/domain/card";
import type { MasterAsset } from "@/domain/master-asset";
import type { ProjectPlan, SlotRef } from "@/domain/plan";
import { slotCardId, withSlotLook } from "@/domain/plan";
import {
  frameLook,
  lookReference,
  withLookReference,
  withLooksInUse,
} from "@/domain/plan-look";
import { Product } from "@/domain/product";
import { resolveLook } from "@/domain/product-look";
import { slotCards } from "@/lib/project-start";
import { drawLook } from "@/server/product-reference";
import { loadProjectBoard, setSlotTuning } from "@/server/project-repository";

// The slot's card as its plan now writes it, on its own destination only.
const derivedCard =
  (ref: SlotRef) =>
  ({
    plan,
    master,
    product,
  }: {
    plan: ProjectPlan;
    master: MasterAsset;
    product: Product;
  }): Card | undefined =>
    slotCards(
      {
        ...plan,
        destinations: plan.destinations.filter(
          (d) => d.destinationId === ref.destinationId,
        ),
      },
      master,
      product,
    ).find((card) => card.id === slotCardId(ref.destinationId, ref.slotKey));

// Tune one scene slot (free): the plan keeps the change and the slot's card
// is written again from it, on its own destination only. The board's Tune
// and the reject_frame tool both tune through here.
export function retuneSlot(
  projectId: string,
  ref: SlotRef,
  tune: (plan: ProjectPlan) => ProjectPlan,
) {
  return setSlotTuning(projectId, ref, tune, derivedCard(ref));
}

// A frame's own colour and style (ROADMAP P2-9), free: a colour or style
// given, null to follow the project's again, left out to keep the frame's.
// Kiln draws the look when the project has none of it yet, then writes the
// frame's whole card in it (its product's words and material sample; the
// maker's own fields stay). Nothing is generated. Refused, with why, for a
// look the product cannot show.
export async function relookSlot(
  projectId: string,
  ref: SlotRef,
  asked: { colour?: string | null; style?: string | null },
) {
  const loaded = await loadProjectBoard(projectId);
  const plan = loaded?.board.plan;
  if (!plan || !loaded?.product) {
    throw new Error("Only a planned project with a product takes a look.");
  }
  // The version of the product the project follows.
  const product =
    Product.safeParse(loaded.version?.snapshot).data ?? loaded.product;
  const slot = plan.destinations
    .find((d) => d.destinationId === ref.destinationId)
    ?.slots.find((s) => s.key === ref.slotKey);
  if (slot?.fill !== "scene" || slot.versionOf) {
    throw new Error("Only a scene takes a colour and style of its own.");
  }
  const chosen = frameLook(product, plan, slot.look, asked);
  if ("refused" in chosen) throw new Error(chosen.refused);
  const look = resolveLook(product, chosen.look, plan.look);
  const drawn =
    chosen.look && !lookReference(plan, look)
      ? await drawLook(product, look)
      : null;
  if (drawn && "refused" in drawn) throw new Error(drawn.refused);
  return setSlotTuning(
    projectId,
    ref,
    // The looks no frame shows any more are dropped.
    (p) =>
      withLooksInUse(
        withSlotLook(drawn ? withLookReference(p, drawn) : p, ref, chosen.look),
        product,
      ),
    derivedCard(ref),
    "card",
  );
}

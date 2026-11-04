import { type PlanSlot, type ProjectPlan, versionSource } from "@/domain/plan";
import { colourOf, type Product } from "@/domain/product";
import {
  type Look,
  ORIGINAL,
  productInLook,
  productStyles,
  type ResolvedLook,
  resolveLook,
  sameLook,
  storedLook,
} from "@/domain/product-look";
import {
  type LookReference,
  type ThreeQuarterView,
  threeQuarterFor,
} from "@/domain/scene-reference";

// The look a project shows: the colour and style New project picked, else the
// product's default colour and own drawing. The product's own default never
// changes for it (DOGFOOD #47).

export function projectLook(
  plan: Pick<ProjectPlan, "look">,
  product: Product,
): ResolvedLook {
  return resolveLook(product, plan.look);
}

const lookOf = (ref: LookReference): ResolvedLook => ({
  colour: ref.colour,
  style: ref.style ?? null,
});

// What Kiln drew for a look of the project, if it drew it.
export function lookReference(
  plan: Pick<ProjectPlan, "references">,
  look: ResolvedLook,
): LookReference | null {
  return (
    plan.references?.looks?.find((ref) => sameLook(lookOf(ref), look)) ?? null
  );
}

// The plan keeping a look Kiln drew, in place of an earlier drawing of it.
export function withLookReference(
  plan: ProjectPlan,
  drawn: LookReference,
): ProjectPlan {
  const looks = (plan.references?.looks ?? []).filter(
    (ref) => !sameLook(lookOf(ref), lookOf(drawn)),
  );
  return {
    ...plan,
    references: { ...plan.references, looks: [...looks, drawn] },
  };
}

// The plan keeping exactly these drawn looks (after the product changed).
export function withLookReferences(
  plan: ProjectPlan,
  drawn: LookReference[],
): ProjectPlan {
  const { looks: _old, ...kept } = plan.references ?? {};
  const references = drawn.length > 0 ? { ...kept, looks: drawn } : kept;
  const { references: _references, ...rest } = plan;
  return Object.keys(references).length > 0 ? { ...rest, references } : rest;
}

export const drawnLooks = (plan: Pick<ProjectPlan, "references">) =>
  (plan.references?.looks ?? []).map(lookOf);

// The product as the project shows it: in its look, drawn from the design
// Kiln redrew for it. Exact frames, the understanding and the scenes read it.
export function projectProduct(product: Product, plan: ProjectPlan): Product {
  const look = projectLook(plan, product);
  return productInLook(product, look, lookReference(plan, look)?.design);
}

// The look a new project asks for, checked against its product: what the
// plan stores (nothing for the product's own default), or why not. Kiln
// draws other colours and styles only from a design file.
export function chosenLook(
  product: Product,
  asked: Look | undefined,
): { look?: Look } | { refused: string } {
  if (!asked || (asked.colour === undefined && asked.style === undefined)) {
    return {};
  }
  if (
    asked.colour !== undefined &&
    !product.colours.some((c) => c.key === asked.colour)
  ) {
    return { refused: `${product.name} has no colour "${asked.colour}".` };
  }
  const look = resolveLook(product, asked);
  if (
    asked.style !== undefined &&
    asked.style !== "original" &&
    look.style !== asked.style
  ) {
    return { refused: `${product.name} has no style "${asked.style}".` };
  }
  const colour = colourOf(product, look.colour);
  if (!colour.inStock) {
    return {
      refused: `${colour.name} is out of stock: its scenes would sell a look you cannot ship.`,
    };
  }
  if (sameLook(look, resolveLook(product))) return {};
  if (product.source.kind !== "vector") {
    return {
      refused: `Kiln draws other colours from a design file: ${product.name}'s scenes show ${colourOf(product, product.defaultColour).name}.`,
    };
  }
  return { look: storedLook(look) };
}

// The look a frame shows, chosen per frame: its own over the project's. A
// version re-frames its source scene, so it shows the source's.
export function slotLook(
  plan: ProjectPlan,
  slot: Pick<PlanSlot, "look" | "versionOf">,
  product: Product,
): ResolvedLook {
  const source = slot.versionOf ? versionSource(plan, slot)?.slot : undefined;
  return resolveLook(product, (source ?? slot).look, plan.look);
}

// The product as a frame shows it, drawn from the design Kiln redrew for its
// look.
export function slotProduct(
  product: Product,
  plan: ProjectPlan,
  slot: Pick<PlanSlot, "look" | "versionOf">,
): Product {
  const look = slotLook(plan, slot, product);
  return productInLook(product, look, lookReference(plan, look)?.design);
}

// The view from above a frame's scene may edit: the project's, while its
// reference is the plate it was drawn beside, or the one Kiln drew for the
// frame's own look.
export function slotView(
  plan: ProjectPlan,
  slot: Pick<PlanSlot, "look" | "versionOf">,
  masterUrl: string | undefined,
  product: Product,
): ThreeQuarterView | null {
  const look = slotLook(plan, slot, product);
  return sameLook(look, projectLook(plan, product))
    ? threeQuarterFor(plan.references, masterUrl)
    : (lookReference(plan, look)?.threeQuarter ?? null);
}

// A frame's look as the maker changes it: a colour or a style given, null to
// follow the project's again, undefined to keep the frame's. What the slot
// stores (nothing when it shows the project's look), or why not.
export function frameLook(
  product: Product,
  plan: ProjectPlan,
  current: Look | undefined,
  asked: { colour?: string | null; style?: string | null },
): { look?: Look } | { refused: string } {
  const pick = (key: "colour" | "style") =>
    asked[key] === undefined ? current?.[key] : (asked[key] ?? undefined);
  const colour = pick("colour");
  const style = pick("style");
  if (colour !== undefined) {
    const found = product.colours.find((c) => c.key === colour);
    if (!found)
      return { refused: `${product.name} has no colour "${colour}".` };
    if (!found.inStock) {
      return {
        refused: `${found.name} is out of stock: its scenes would sell a look you cannot ship.`,
      };
    }
  }
  if (
    style !== undefined &&
    style !== ORIGINAL &&
    !productStyles(product).some((s) => s.key === style)
  ) {
    return { refused: `${product.name} has no style "${style}".` };
  }
  const own: Look = {
    ...(colour !== undefined ? { colour } : {}),
    ...(style !== undefined ? { style } : {}),
  };
  if (
    sameLook(resolveLook(product, own, plan.look), projectLook(plan, product))
  ) {
    return {};
  }
  if (product.source.kind !== "vector") {
    return {
      refused:
        "Kiln draws other colours and styles from a design file; this product has none.",
    };
  }
  return { look: own };
}

// The plan without the frame looks Kiln no longer draws (after an update
// left them out): those frames show the project's look again.
export function withoutUndrawnLooks(
  plan: ProjectPlan,
  product: Product,
): ProjectPlan {
  const project = projectLook(plan, product);
  return {
    ...plan,
    destinations: plan.destinations.map((d) => ({
      ...d,
      slots: d.slots.map((slot) => {
        if (!slot.look) return slot;
        const look = resolveLook(product, slot.look, plan.look);
        if (sameLook(look, project) || lookReference(plan, look)) return slot;
        const { look: _dropped, ...rest } = slot;
        return rest;
      }),
    })),
  };
}

// The plan keeping only the looks in use: the project's and each scene's
// own. A look a frame tried and left is dropped, so the plan never fills
// with drawings no frame shows.
export function withLooksInUse(
  plan: ProjectPlan,
  product: Product,
): ProjectPlan {
  const used = [
    projectLook(plan, product),
    ...plan.destinations
      .flatMap((d) => d.slots)
      .filter((slot) => slot.fill === "scene" && slot.look)
      .map((slot) => resolveLook(product, slot.look, plan.look)),
  ];
  return withLookReferences(
    plan,
    (plan.references?.looks ?? []).filter((ref) =>
      used.some((look) => sameLook(look, lookOf(ref))),
    ),
  );
}

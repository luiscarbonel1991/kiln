import type { ProjectPlan } from "@/domain/plan";
import { colourOf, type Product } from "@/domain/product";
import {
  type Look,
  productInLook,
  type ResolvedLook,
  resolveLook,
  sameLook,
  storedLook,
} from "@/domain/product-look";
import type { LookReference } from "@/domain/scene-reference";

// The look a project shows (ROADMAP P2-9): the colour and style New project
// picked, else the product's default colour and own drawing. The product's
// own default never changes for it (DOGFOOD #47).

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

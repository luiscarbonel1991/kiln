import type { ListingText } from "@/domain/listing";
import type { Recipe } from "@/domain/recipe";
import { sceneVariants } from "@/domain/scene-direction";
import type { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import type { ArtDirector } from "@/providers/interfaces";
import type {
  ListingCopy,
  ProductReview,
  ReviewField,
} from "@/providers/text-prompts";

// The recipe's own per-slot art direction (domain sceneVariants), with the
// analysis's place of use for `{use}`: what mock runs return, and what a maker
// can choose when no model could direct the scenes. Slots past the recipe's
// own get a numbered direction.
export function fallbackVariants(
  recipe: Recipe,
  understanding: BaseUnderstanding,
  n: number,
): VariantDirection[] {
  const slots = Array.from(
    { length: n },
    (_unused, i) =>
      recipe.directions[i] ?? {
        label: `Direction ${i + 1}`,
        purpose: `direction ${i + 1}`,
      },
  );
  return sceneVariants(
    slots,
    recipe.fieldDefaults,
    understanding,
    understanding.useContext ? [understanding.useContext] : [],
  );
}

// What mock runs write for a listing: the free draft itself (marked as the
// model's by the board), so the flow can be tried without a paid call.
export function mockListingCopy(draft: ListingText): ListingCopy {
  return {
    title: draft.title.value,
    description: draft.description.value,
    tags: draft.tags.value,
    materials: draft.materials.value,
  };
}

// What mock runs answer for a product review: a few suggestions read from the
// form by fixed rules (an example for a line without one, a label for an
// example without one, a colour name capitalized, a hook from the name) and a
// check on the size, so the flow can be tried without a paid call.
export function mockProductReview(fields: ReviewField[]): ProductReview {
  const value = (field: string) =>
    fields.find((f) => f.field === field)?.value.trim() ?? "";
  const suggestions: ProductReview["suggestions"] = [];
  for (const f of fields) {
    const line = /^wording\.(\d+)\.label$/.exec(f.field);
    if (line) {
      const label = f.value.trim();
      const example = value(`wording.${line[1]}.example`);
      if (label && !example) {
        suggestions.push({
          field: `wording.${line[1]}.example`,
          value: /date/i.test(label) ? "June 14" : "Sofia",
          why: "How to personalize shows this example; without one its box is empty.",
        });
      }
      if (!label && example) {
        suggestions.push({
          field: f.field,
          value: "Name",
          why: "The buyer is asked this; your text stays as the example.",
        });
      }
    }
    if (/^colours\.\d+\.name$/.test(f.field)) {
      const name = f.value.trim();
      if (name && name === name.toLowerCase() && /[a-z]/.test(name)) {
        suggestions.push({
          field: f.field,
          value: name.replace(/\b[a-z]/g, (c) => c.toUpperCase()),
          why: "Colour options and the listing show it as a name.",
        });
      }
    }
  }
  if (
    value("name") &&
    !value("hook") &&
    fields.some((f) => f.field === "hook")
  ) {
    suggestions.push({
      field: "hook",
      value: value("name"),
      why: "A carousel opens on its hook; the name says what it is.",
    });
  }
  const size = value("size");
  return {
    suggestions,
    checks: size
      ? [{ field: "size", why: `Confirm the size before you save: ${size}.` }]
      : [],
  };
}

export const mockArtDirector: ArtDirector = {
  async writeListing({ draft }, options) {
    return { value: mockListingCopy(draft), model: options.model };
  },
  async proposeDirections({ recipe, understanding, n }, options) {
    return {
      value: fallbackVariants(recipe, understanding, n),
      model: options.model,
    };
  },
};

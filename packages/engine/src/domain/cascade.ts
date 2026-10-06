import { z } from "zod";
import type { BrandProfile } from "@/domain/brand";
import { Field } from "@/domain/field";
import { lockByDefault } from "@/domain/locks";
import type { MasterAsset } from "@/domain/master-asset";
import type { Recipe } from "@/domain/recipe";
import type { BaseUnderstanding } from "@/domain/understanding";

// The seven reconciled card fields. Drives resolveField, buildPlanningContext,
// and the Planning UI rows. The full analysis (subject, materials, lighting,
// composition, mood, palette) flows through; scene is the recipe's addition.
export const FIELD_KEYS = [
  "subject",
  "materials",
  "scene",
  "composition",
  "lighting",
  "mood",
  "palette",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

// One resolved Field per key — the planning context (and a card's fields).
export const PlanningFields = z.object({
  subject: Field,
  materials: Field,
  scene: Field,
  composition: Field,
  lighting: Field,
  mood: Field,
  palette: Field,
});
export type PlanningFields = z.infer<typeof PlanningFields>;

// Carries the only local layer (user edits) + a reference list. Planning passes
// undefined; a future Card (full fields record + references) is assignable.
export interface CardFieldsLike {
  fields?: Partial<Record<FieldKey, Field>>;
  references?: string[];
}

// The image layer (BaseUnderstanding) owns everything the analysis extracted —
// subject, materials, composition, lighting, mood, and the palette — so the full
// photo context carries into planning (image > brand in the cascade). Brand is the
// palette fallback below.
function imageValue(
  key: FieldKey,
  understanding: BaseUnderstanding,
): string | undefined {
  if (key === "subject") return understanding.subject;
  if (key === "materials") return understanding.materials;
  if (key === "composition") return understanding.composition;
  if (key === "lighting") return understanding.lighting;
  if (key === "mood") return understanding.mood;
  if (key === "palette") {
    return understanding.palette.length > 0
      ? understanding.palette.join(", ")
      : undefined;
  }
  return undefined;
}

// The brand layer provides the palette fallback when the image had none, as the
// joined hex list (editable text).
function brandValue(key: FieldKey, brand: BrandProfile): string | undefined {
  return key === "palette" ? brand.palette.join(", ") : undefined;
}

// Four-layer cascade, CSS-specificity style: local > recipe > image > brand.
// A key absent from a higher layer falls through to the next; total by design.
export function resolveField(
  key: FieldKey,
  current: CardFieldsLike | undefined,
  understanding: BaseUnderstanding,
  recipe: Recipe,
  brand: BrandProfile,
): Field {
  const local = current?.fields?.[key];
  if (local?.source === "local") {
    return local;
  }
  const fromRecipe = recipe.fieldDefaults[key];
  if (fromRecipe !== undefined) {
    return {
      value: fromRecipe,
      source: "recipe",
      locked: lockByDefault("recipe"),
    };
  }
  const fromImage = imageValue(key, understanding);
  if (fromImage !== undefined) {
    return {
      value: fromImage,
      source: "image",
      locked: lockByDefault("image"),
    };
  }
  const fromBrand = brandValue(key, brand);
  if (fromBrand !== undefined) {
    return {
      value: fromBrand,
      source: "brand",
      locked: lockByDefault("brand"),
    };
  }
  return { value: "", source: "recipe", locked: lockByDefault("recipe") };
}

// Resolves all five keys with no local layer — the initial planning context.
export function buildPlanningContext(
  understanding: BaseUnderstanding,
  recipe: Recipe,
  brand: BrandProfile,
): PlanningFields {
  const resolve = (key: FieldKey): Field =>
    resolveField(key, undefined, understanding, recipe, brand);
  return {
    subject: resolve("subject"),
    materials: resolve("materials"),
    scene: resolve("scene"),
    composition: resolve("composition"),
    lighting: resolve("lighting"),
    mood: resolve("mood"),
    palette: resolve("palette"),
  };
}

// Assembles the generation request for a card (Phase 5). Implemented + tested
// now; the Planning screen does not render it. master.assetUrl is ALWAYS the
// first image input; negatives come straight from the recipe constraints.
export function assemblePrompt(
  current: CardFieldsLike | undefined,
  master: MasterAsset,
  understanding: BaseUnderstanding,
  recipe: Recipe,
  brand: BrandProfile,
  direction = "",
): { prompt: string; imageInputs: string[]; negative: string } {
  // Generate-time read. A built card's `fields` are the already-resolved truth —
  // they hold the ArtDirector's per-slot scene/composition/lighting AND any live
  // user edits. resolveField is the BUILD-time cascade (planning -> card) and would
  // re-derive scene/composition from the recipe defaults, discarding the variant's
  // values (it only honors source==="local"). So here we prefer the card's stored
  // value for any present key, and fall back to the cascade only when there is no
  // card yet (the planning-preview path passes current === undefined).
  // Each value is a clause the template ends with its own period, so a value
  // written as a sentence ("Show it gift-ready.") never doubles it.
  const value = (key: FieldKey) => {
    const stored = current?.fields?.[key];
    const raw = stored
      ? stored.value
      : resolveField(key, current, understanding, recipe, brand).value;
    return raw.trim().replace(/[.\s]+$/, "");
  };
  // Imperative, instruction-style prompt. The image models (Gemini / OpenAI edit)
  // anchor to the reference photo, so a comma-list of attributes barely changes the
  // scene. We instead COMMAND a full scene rebuild while preserving the exact
  // product — that's what moves the product into the in-use/hero/packaging scenes.
  // The direction (slot) leads so each variant is genuinely different.
  const slot = direction ? ` — "${direction}"` : "";
  // When the analysis flagged a mount/hand/stand in the reference photo (sceneProps),
  // name it so the edit removes it — "keep ONLY the product" alone leaves an attached
  // prop (e.g. the stand or hand it was photographed on) riding into the result.
  const props = understanding.sceneProps.trim();
  const ptype = understanding.productType.trim() || value("subject");
  const exclusion = props
    ? `The product is ONLY the ${ptype}. Also in the reference is ${props} — a prop/mount that is NOT part of the product; remove it entirely and do not reproduce it.`
    : "";
  let prompt: string;
  if (recipe.style === "line-art") {
    // Line-art style: redraw the subject as flat black strokes on white —
    // NO photographic framing. The slot's `purpose` is the per-slot "treatment"
    // (outline / detail / framed / etc.), since line-art recipes skip
    // the ArtDirector's photographic scene diversification.
    const treatment =
      recipe.directions.find((d) => d.label === direction)?.purpose ?? "";
    prompt = [
      `Black-and-white line art${slot}.`,
      `Subject: ${value("subject")}. Redraw it as clean, single-weight solid black strokes on a pure white background — closed continuous outlines, high contrast. NO shading, NO gradients, NO grey, NO color, no background scenery, no photographic detail.`,
      props
        ? `Draw ONLY the ${ptype}; exclude ${props} — it is not part of the product.`
        : "",
      treatment ? `Treatment: ${treatment}.` : "",
      `Framing: ${value("scene")}; ${value("composition")}.`,
      "Crisp, vector-ready line work. No text, captions or watermarks.",
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    prompt = [
      `Professional e-commerce product photograph${slot}.`,
      "Take the EXACT product from the reference image — identical shape, engraving, text, label, finish and color — and place it in a completely NEW scene. Replace the original background, surface and setting ENTIRELY; keep ONLY the product unchanged.",
      exclusion,
      `Product: ${value("subject")}; ${value("materials")}.`,
      `Scene: ${value("scene")}.`,
      `Composition: ${value("composition")}.`,
      `Lighting: ${value("lighting")}.`,
      `Mood: ${value("mood")}. Color palette: ${value("palette")}.`,
      "Photorealistic, sharp, high detail. No text, captions, watermarks or graphic overlays.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return {
    prompt,
    imageInputs: [master.assetUrl, ...(current?.references ?? [])],
    // The mount/prop is also a negative so providers that honor one drop it
    // too; so is what the product's treatment must never look like.
    negative: [
      recipe.constraints.negative.join(", "),
      props,
      understanding.avoid.trim(),
    ]
      .filter(Boolean)
      .join(", "),
  };
}

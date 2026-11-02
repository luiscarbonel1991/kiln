import { Card } from "@/domain/card";
import { buildCards } from "@/domain/cards";
import { buildPlanningContext } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import {
  DEFAULT_MAKER_MODELS,
  defaultImageModel,
  defaultVideoModel,
  type MakerModels,
} from "@/domain/model-defaults";
import type { PersistedProject } from "@/domain/persisted-project";
import {
  type PlanSlot,
  type ProjectPlan,
  slotCardId,
  slotRecipeId,
} from "@/domain/plan";
import {
  lookReference,
  projectLook,
  projectProduct,
  slotLook,
} from "@/domain/plan-look";
import { type Product, productImages } from "@/domain/product";
import {
  productInLook,
  type ResolvedLook,
  sameLook,
} from "@/domain/product-look";
import { productUnderstanding } from "@/domain/product-understanding";
import type { ProjectType } from "@/domain/project";
import { productSceneCues, sceneVariants } from "@/domain/scene-direction";
import { effectiveKnobs } from "@/domain/scene-knobs";
import { kilnPick, threeQuarterFor } from "@/domain/scene-reference";
import { SEED_BRAND } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";
import { projectTypeLabel } from "@/lib/project-types";
import { findRecipe } from "@/lib/recipes";

// What a planned project starts with in the editor: the understanding written
// from the spec (no vision call), the product's reference as the anchor, and one
// draft card per scene slot. Drafts cost nothing; a generation runs only when
// the maker presses Generate on a card.

// A photo-source product already has its reference image. It must be a raster
// at an absolute http(s) URL: the providers fetch it server-side and reject SVG.
export function photoReference(product: Product): MasterAsset | null {
  if (product.source.kind !== "photo") return null;
  const url = product.source.assetUrl;
  if (!/^https?:\/\//.test(url)) return null;
  const mime = /\.jpe?g(\?|$)/i.test(url)
    ? "image/jpeg"
    : /\.webp(\?|$)/i.test(url)
      ? "image/webp"
      : /\.png(\?|$)/i.test(url)
        ? "image/png"
        : null;
  if (!mime) return null;
  return {
    id: `product-${product.id}`,
    origin: "product",
    sourcePrompt: null,
    assetUrl: url,
    mime,
  };
}

// One draft card per scene slot, per destination. Ids are `${destination}.${slot}`
// (unique across destinations; a video child appends "-video"); the recipe is
// the slot's shot list composed on its destination. Cards come from the plan's
// own scene slots (the plan is the project's snapshot, so a shot list edited
// since keeps working), each with its slot's art direction and the product's
// places of use in order; line-art shot lists keep the planning fields, as in
// the studio.
export function slotCards(
  plan: ProjectPlan,
  master: MasterAsset,
  stored: Product,
  models: MakerModels = DEFAULT_MAKER_MODELS,
): Card[] {
  // Every card is written for the product as its frame shows it: in the
  // project's colour and style, or the frame's own (plan-look.ts).
  const project = projectLook(plan, stored);
  const understanding = productUnderstanding(projectProduct(stored, plan));
  return plan.destinations.flatMap((d) => {
    const recipe = findRecipe(slotRecipeId(d.shotListId, d.destinationId));
    if (!recipe) {
      throw new Error(`no recipe for ${d.shotListId} on ${d.destinationId}`);
    }
    // A version re-frames another scene: it takes no direction and no place
    // of use from the scenes, only a card of its own (below).
    const scenes = d.slots.filter((s) => s.fill === "scene" && !s.versionOf);
    const slotRecipe = {
      ...recipe,
      directions: scenes.map((s) => ({
        label: s.label,
        purpose: s.purpose,
        ...(s.aspect ? { aspect: s.aspect } : {}),
      })),
    };
    // Every scene written in one look: run once per look the scenes show,
    // so the product's places of use keep their order whatever look a scene
    // takes.
    const run = (look: ResolvedLook) => {
      const product = productInLook(
        stored,
        look,
        lookReference(plan, look)?.design,
      );
      const words = sameLook(look, project)
        ? understanding
        : productUnderstanding(product);
      // A view from above drawn for this look: Kiln starts the scenes that
      // offer the camera a little above (the maker's stop still wins).
      const view = sameLook(look, project)
        ? threeQuarterFor(plan.references, master.assetUrl)
        : (lookReference(plan, look)?.threeQuarter ?? null);
      const variants =
        recipe.style === "line-art"
          ? undefined
          : sceneVariants(
              // Each slot applies its knobs: its defaults, Kiln's pick, the
              // maker's kept lessons, then the maker's own choices.
              scenes.map((s) =>
                s.knobs
                  ? {
                      ...s,
                      knobs: effectiveKnobs(
                        s.knobs,
                        s.tuned,
                        kilnPick(s.knobs, view),
                        s.learned,
                      ).stops,
                    }
                  : s,
              ),
              recipe.fieldDefaults,
              words,
              product.useContexts,
              productSceneCues(product),
            );
      return {
        cards: buildCards({
          master,
          recipe: slotRecipe,
          planning: buildPlanningContext(words, recipe, SEED_BRAND),
          variants,
          imageModel: defaultImageModel(models),
        }),
        // A photographic scene reads the sample and the views after the
        // reference, in the order the product's text names them.
        images:
          recipe.style === "line-art"
            ? []
            : productImages(product).map((i) => i.url),
      };
    };
    const runs = new Map<string, ReturnType<typeof run>>();
    const sceneCards = scenes.map((s, i) => {
      const look = slotLook(plan, s, stored);
      const key = `${look.colour}/${look.style ?? ""}`;
      const written = runs.get(key) ?? run(look);
      runs.set(key, written);
      return {
        ...written.cards[i],
        id: slotCardId(d.destinationId, s.key),
        status: "draft" as const,
        references: written.images,
      };
    });
    const videoCards = d.slots
      .filter((s) => s.fill === "video")
      .map((s) =>
        videoSlotCard(
          d.destinationId,
          d.shotListId,
          s,
          master,
          understanding,
          models,
        ),
      );
    const versionCards = d.slots
      .filter((s) => s.fill === "scene" && s.versionOf)
      .map((s) =>
        versionSlotCard(
          d.destinationId,
          d.shotListId,
          s,
          master,
          understanding,
          models,
        ),
      );
    return [...sceneCards, ...versionCards, ...videoCards];
  });
}

// A version slot's card: it holds the re-framed image the queue makes from
// the source's approved scene (built at queue time, not from these fields),
// on the maker's image model at the slot's aspect.
export function versionSlotCard(
  destinationId: string,
  shotListId: string,
  slot: PlanSlot,
  master: MasterAsset,
  understanding: BaseUnderstanding,
  models: MakerModels = DEFAULT_MAKER_MODELS,
): Card {
  const recipe = findRecipe(slotRecipeId(shotListId, destinationId));
  if (!recipe)
    throw new Error(`no recipe for ${shotListId} on ${destinationId}`);
  const planning = buildPlanningContext(understanding, recipe, SEED_BRAND);
  const [base] = buildCards({
    master,
    recipe: {
      ...recipe,
      directions: [{ label: slot.label, purpose: slot.purpose }],
    },
    planning,
    imageModel: defaultImageModel(models),
  });
  return Card.parse({
    ...base,
    id: slotCardId(destinationId, slot.key),
    model: { ...base.model, aspect: slot.aspect ?? base.model.aspect },
    status: "draft",
    references: [],
  });
}

// A video slot's card: it holds the clip the queue renders (outputs, status);
// what it animates and how live on the plan slot. Its fields mirror a scene
// card's, so the editor can show it.
export function videoSlotCard(
  destinationId: string,
  shotListId: string,
  slot: PlanSlot,
  master: MasterAsset,
  understanding: BaseUnderstanding,
  models: MakerModels = DEFAULT_MAKER_MODELS,
): Card {
  const recipe = findRecipe(slotRecipeId(shotListId, destinationId));
  if (!recipe)
    throw new Error(`no recipe for ${shotListId} on ${destinationId}`);
  const planning = buildPlanningContext(understanding, recipe, SEED_BRAND);
  const [base] = buildCards({
    master,
    recipe: {
      ...recipe,
      directions: [{ label: slot.label, purpose: slot.purpose }],
    },
    planning,
  });
  return Card.parse({
    ...base,
    id: slotCardId(destinationId, slot.key),
    type: "video",
    model: { ...base.model, ...defaultVideoModel(models), aspect: "9:16" },
    video: { durationSec: 8, motion: "light", startFrameAssetId: null },
    status: "draft",
  });
}

export function projectName(product: Product, type: ProjectType): string {
  return `${product.name} — ${projectTypeLabel(type)}`.slice(0, 80);
}

export function startEditorState(input: {
  product: Product;
  type: ProjectType;
  plan: ProjectPlan;
  master: MasterAsset | null;
  models?: MakerModels;
}): PersistedProject {
  const { product, plan, master } = input;
  const understanding = productUnderstanding(projectProduct(product, plan));
  const first = plan.destinations[0];
  return {
    name: projectName(product, input.type),
    phase: "generation",
    master,
    understanding,
    recipeId: slotRecipeId(first.shotListId, first.destinationId),
    planning: null,
    cards: master ? slotCards(plan, master, product, input.models) : [],
  };
}

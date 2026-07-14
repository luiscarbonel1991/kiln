import { describe, expect, it } from "vitest";
import { buildCards } from "@/domain/cards";
import { buildPlanningContext } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import { DEFAULT_MODEL_IDS } from "@/domain/model-defaults";
import { SEED_BRAND, SEED_RECIPE, SEED_RECIPE_ADS } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";

const understanding: BaseUnderstanding = {
  subject: "glazed stoneware pitcher, matte cream finish",
  productType: "ceramic pitcher",
  useContext: "sits on a kitchen counter or shelf",
  sceneProps: "",
  materials: "stoneware, reactive glaze",
  lighting: "soft directional light, upper-left",
  composition: "centered, slight high angle",
  mood: "calm, handmade, editorial",
  palette: ["#c0461f", "#e8a13a"],
};

const master: MasterAsset = {
  id: "master-1",
  origin: "upload",
  sourcePrompt: null,
  assetUrl: "blob:https://app/abc",
  mime: "image/png",
};

const planning = buildPlanningContext(understanding, SEED_RECIPE, SEED_BRAND);

describe("buildCards", () => {
  const cards = buildCards({ master, recipe: SEED_RECIPE, planning });

  it("builds one card per listing slot, anchored to the master", () => {
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card.masterAssetId).toBe("master-1");
      expect(card.recipeId).toBe(SEED_RECIPE.id);
      expect(card.type).toBe("image");
      expect(card.references).toEqual([]);
    }
    expect(cards.map((c) => c.direction)).toEqual(
      SEED_RECIPE.directions.map((d) => d.label),
    );
  });

  it("locks image/brand fields and unlocks recipe fields at creation", () => {
    const card = cards[0];
    expect(card.fields.subject.source).toBe("image");
    expect(card.fields.subject.locked).toBe(true);
    expect(card.fields.palette.source).toBe("image");
    expect(card.fields.palette.locked).toBe(true);
    expect(card.fields.scene.source).toBe("recipe");
    expect(card.fields.scene.locked).toBe(false);
  });

  it("defaults to the google provider with the pinned model id", () => {
    const card = cards[0];
    expect(card.model.provider).toBe("google");
    expect(card.model.model).toBe(DEFAULT_MODEL_IDS.google.image);
  });

  it("respects an explicit n", () => {
    expect(
      buildCards({ master, recipe: SEED_RECIPE, planning, n: 2 }),
    ).toHaveLength(2);
  });

  it("builds one card per slot for a recipe that is not six slots (no orphans)", () => {
    const adPlanning = buildPlanningContext(
      understanding,
      SEED_RECIPE_ADS,
      SEED_BRAND,
    );
    const adCards = buildCards({
      master,
      recipe: SEED_RECIPE_ADS,
      planning: adPlanning,
    });
    expect(adCards).toHaveLength(SEED_RECIPE_ADS.directions.length);
    expect(adCards.map((c) => c.direction)).toEqual(
      SEED_RECIPE_ADS.directions.map((d) => d.label),
    );
    expect(adCards.some((c) => /^Direction \d/.test(c.direction))).toBe(false);
  });
});

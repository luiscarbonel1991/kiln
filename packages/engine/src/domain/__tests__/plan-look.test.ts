import { describe, expect, it } from "vitest";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import { DOOR_TAG } from "@/domain/__tests__/fixtures/door-tag";
import type { ProjectPlan } from "@/domain/plan";
import {
  chosenLook,
  lookReference,
  projectLook,
  projectProduct,
  withLookReference,
  withLookReferences,
} from "@/domain/plan-look";
import { Product } from "@/domain/product";

const plan = (extra: Partial<ProjectPlan> = {}): ProjectPlan => ({
  destinations: [],
  ...extra,
});
const gold = {
  colour: "gold-black",
  design: "https://stub.local/products/gold.svg",
  front: "https://stub.local/plates/gold.png",
};

describe("the project's look", () => {
  it("is the one New project picked, else the product's default", () => {
    expect(projectLook(plan(), DOOR_TAG)).toEqual({
      colour: "black-white",
      style: null,
    });
    expect(
      projectLook(plan({ look: { colour: "gold-black" } }), DOOR_TAG),
    ).toEqual({ colour: "gold-black", style: null });
  });

  it("keeps one drawing per look, the newest", () => {
    const once = withLookReference(plan(), gold);
    const twice = withLookReference(once, {
      ...gold,
      front: "https://stub.local/plates/gold-2.png",
    });
    expect(twice.references?.looks).toHaveLength(1);
    expect(
      lookReference(twice, { colour: "gold-black", style: null })?.front,
    ).toBe("https://stub.local/plates/gold-2.png");
    expect(
      lookReference(twice, { colour: "gold-black", style: "do-not-disturb" }),
    ).toBeNull();
    expect(withLookReferences(twice, [])).not.toHaveProperty("references");
  });

  it("shows the product in the project's look, drawn from its redrawn design", () => {
    const shown = projectProduct(
      DOOR_TAG,
      withLookReference(plan({ look: { colour: "gold-black" } }), gold),
    );
    expect(shown.defaultColour).toBe("gold-black");
    expect(shown.source).toMatchObject({ svgUrl: gold.design });
    // The product itself is untouched.
    expect(DOOR_TAG.defaultColour).toBe("black-white");
  });
});

describe("chosenLook", () => {
  it("stores nothing for the product's own default, and the look otherwise", () => {
    expect(chosenLook(DOOR_TAG, undefined)).toEqual({});
    expect(chosenLook(DOOR_TAG, { colour: "black-white" })).toEqual({});
    expect(
      chosenLook(DOOR_TAG, { colour: "gold-black", style: "do-not-disturb" }),
    ).toEqual({ look: { colour: "gold-black", style: "do-not-disturb" } });
  });

  it("refuses a colour or style the product does not offer, one out of stock, and another colour of a product with no design file", () => {
    expect(chosenLook(DOOR_TAG, { colour: "copper" })).toEqual({
      refused: 'Engraved door tag has no colour "copper".',
    });
    expect(chosenLook(DOOR_TAG, { style: "welcome" })).toEqual({
      refused: 'Engraved door tag has no style "welcome".',
    });
    expect(chosenLook(CUTTING_BOARD, { colour: "cherry" })).toEqual({
      refused:
        "Cherry is out of stock: its scenes would sell a look you cannot ship.",
    });
    expect(chosenLook(CUTTING_BOARD, { colour: "walnut" })).toEqual({
      refused:
        "Kiln draws other colours from a design file: Engraved family cutting board's scenes show Maple.",
    });
    const photo = Product.parse({
      ...DOOR_TAG,
      source: { kind: "photo", assetUrl: "https://stub.local/tag.png" },
    });
    expect(chosenLook(photo, { style: "do-not-disturb" })).toEqual({
      refused: 'Engraved door tag has no style "do-not-disturb".',
    });
  });
});

import { describe, expect, it } from "vitest";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import { DOOR_TAG } from "@/domain/__tests__/fixtures/door-tag";
import {
  type ProjectPlan,
  planProject,
  withSlotLook,
  withThreeQuarter,
} from "@/domain/plan";
import {
  chosenLook,
  frameLook,
  lookReference,
  projectLook,
  projectProduct,
  slotLook,
  slotProduct,
  slotView,
  withLookReference,
  withLookReferences,
  withoutUndrawnLooks,
} from "@/domain/plan-look";
import { Product } from "@/domain/product";
import { SEED_DESTINATIONS, SEED_SHOT_LISTS } from "@/domain/seed";

const catalog = {
  destinations: SEED_DESTINATIONS,
  shotLists: SEED_SHOT_LISTS,
};

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

describe("a frame's look", () => {
  const planned = planProject({
    product: DOOR_TAG,
    type: "listing-kit",
    destinationIds: ["etsy"],
    catalog,
  });
  const hero = { destinationId: "etsy", slotKey: "hero" };

  it("is its own over the project's; a version shows its source's", () => {
    const own = withSlotLook(planned, hero, { colour: "gold-black" });
    const slots = own.destinations.flatMap((d) => d.slots);
    const heroSlot = slots.find((s) => s.key === "hero");
    const version = slots.find((s) => s.versionOf === "etsy.hero");
    if (!heroSlot) throw new Error("no hero");
    expect(slotLook(own, heroSlot, DOOR_TAG).colour).toBe("gold-black");
    if (version) {
      expect(slotLook(own, version, DOOR_TAG).colour).toBe("gold-black");
    }
    expect(
      slotProduct(DOOR_TAG, withLookReference(own, gold), heroSlot).source,
    ).toMatchObject({ svgUrl: gold.design });
    expect(() =>
      withSlotLook(
        planned,
        { destinationId: "etsy", slotKey: "size" },
        {
          colour: "gold-black",
        },
      ),
    ).toThrow("only a scene");
  });

  it("changes a colour or a style, follows the project's again with null, and stores nothing for the project's look", () => {
    expect(
      frameLook(DOOR_TAG, planned, undefined, { colour: "gold-black" }),
    ).toEqual({
      look: { colour: "gold-black" },
    });
    expect(
      frameLook(
        DOOR_TAG,
        planned,
        { colour: "gold-black" },
        { style: "do-not-disturb" },
      ),
    ).toEqual({ look: { colour: "gold-black", style: "do-not-disturb" } });
    expect(
      frameLook(
        DOOR_TAG,
        planned,
        { colour: "gold-black", style: "do-not-disturb" },
        { colour: null },
      ),
    ).toEqual({ look: { style: "do-not-disturb" } });
    expect(
      frameLook(
        DOOR_TAG,
        planned,
        { colour: "gold-black" },
        { colour: "black-white" },
      ),
    ).toEqual({});
    expect(
      frameLook(DOOR_TAG, planned, undefined, { colour: "copper" }),
    ).toEqual({
      refused: 'Engraved door tag has no colour "copper".',
    });
    expect(
      frameLook(CUTTING_BOARD, { destinations: [] }, undefined, {
        colour: "walnut",
      }),
    ).toEqual({
      refused:
        "Kiln draws other colours and styles from a design file; this product has none.",
    });
  });

  it("a frame whose look Kiln no longer draws shows the project's again", () => {
    const own = withSlotLook(withLookReference(planned, gold), hero, {
      colour: "gold-black",
    });
    expect(
      withoutUndrawnLooks(own, DOOR_TAG).destinations[0].slots.find(
        (s) => s.key === "hero",
      )?.look,
    ).toEqual({ colour: "gold-black" });
    const undrawn = withoutUndrawnLooks(withLookReferences(own, []), DOOR_TAG);
    expect(
      undrawn.destinations[0].slots.find((s) => s.key === "hero"),
    ).not.toHaveProperty("look");
  });

  it("edits the view from above drawn for its look, or the project's", () => {
    const view = {
      assetUrl: "https://stub.local/above.png",
      angleDeg: 30,
      front: "https://stub.local/front.png",
    };
    const goldAbove = {
      ...view,
      assetUrl: "https://stub.local/gold-above.png",
      front: gold.front,
    };
    const p = withSlotLook(
      withLookReference(withThreeQuarter(planned, view), {
        ...gold,
        threeQuarter: goldAbove,
      }),
      hero,
      { colour: "gold-black" },
    );
    const slots = p.destinations[0].slots;
    const heroSlot = slots.find((s) => s.key === "hero");
    const other = slots.find((s) => s.fill === "scene" && s.key !== "hero");
    if (!heroSlot || !other) throw new Error("no scenes");
    expect(slotView(p, heroSlot, view.front, DOOR_TAG)).toEqual(goldAbove);
    expect(slotView(p, other, view.front, DOOR_TAG)).toEqual(view);
  });
});

import { describe, expect, it } from "vitest";
import type { MasterAsset } from "@/domain/master-asset";
import { planProject } from "@/domain/plan";
import { Product } from "@/domain/product";
import { productUnderstanding } from "@/domain/product-understanding";
import {
  photoReference,
  projectName,
  slotCards,
  startEditorState,
} from "@/lib/project-start";
import { CATALOG, findRecipe } from "@/lib/recipes";

const board = Product.parse({
  id: "prod-1",
  sku: "CB-01",
  name: "Engraved family cutting board",
  family: "Kitchen",
  dimensions: { w: 16, h: 10, unit: "in" },
  shape: "rounded rectangle board",
  material: "solid hardwood",
  treatment: "engraved",
  colours: [{ key: "maple", name: "Maple", face: "#E8D2A6" }],
  defaultColour: "maple",
  typography: { family: "Fraunces" },
  wording: [{ label: "Family name", maxChars: 14, example: "The Riveras" }],
  useContexts: ["a kitchen counter during dinner prep", "a set dinner table"],
  source: { kind: "photo", assetUrl: "https://cdn.example.com/board.jpg" },
});

const master: MasterAsset = {
  id: "m-1",
  origin: "product",
  sourcePrompt: null,
  assetUrl: "https://cdn.example.com/board.jpg",
  mime: "image/jpeg",
};

const plan = planProject({
  product: board,
  type: "launch",
  destinationIds: ["etsy", "instagram"],
  catalog: CATALOG,
});

describe("findRecipe for planned slots", () => {
  it("composes a shot list on its destination, scene slots only", () => {
    const recipe = findRecipe("etsy-listing@etsy");
    expect(recipe?.directions.map((d) => d.label)).toEqual([
      "Marketplace hero",
      "In-use mockup",
      "Lifestyle scene",
      "Material detail",
      "Packaging / gift",
    ]);
    expect(recipe?.constraints.negative).toContain("text overlay");
  });

  it("rejects a shot list on a destination it does not target", () => {
    expect(findRecipe("etsy-listing@instagram")).toBeUndefined();
    expect(findRecipe("nope@etsy")).toBeUndefined();
  });
});

describe("slotCards", () => {
  const cards = slotCards(
    plan,
    master,
    productUnderstanding(board),
    board.useContexts,
  );
  const scene = (id: string) =>
    cards.find((c) => c.id === id)?.fields.scene.value ?? "";

  it("one draft card per scene slot, ids unique across destinations", () => {
    expect(cards.map((c) => c.id)).toEqual([
      "etsy.hero",
      "etsy.in-use",
      "etsy.lifestyle",
      "etsy.detail",
      "etsy.gift",
      "instagram.hook",
      "instagram.in-place",
      "instagram.detail",
    ]);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    expect(cards.every((c) => c.status === "draft")).toBe(true);
  });

  it("each card resolves its recipe and keeps its slot's aspect and label", () => {
    const hook = cards.find((c) => c.id === "instagram.hook");
    expect(hook?.recipeId).toBe("instagram-carousel@instagram");
    expect(findRecipe(hook?.recipeId ?? "")).toBeDefined();
    expect(hook?.direction).toBe("Hook");
    expect(hook?.model.aspect).toBe("4:5");
    expect(hook?.fields.scene.value).toBe(
      "the product at a kitchen counter during dinner prep, styled and inviting",
    );
  });

  it("each scene has its own direction; the places of use go in order", () => {
    expect(scene("etsy.in-use")).toContain(
      "in use at a kitchen counter during dinner prep",
    );
    expect(scene("etsy.lifestyle")).toContain("at a set dinner table");
    expect(scene("etsy.detail")).toContain("macro");
    expect(scene("etsy.gift")).toContain("gift packaging");
    const etsy = cards.filter((c) => c.id.startsWith("etsy."));
    expect(new Set(etsy.map((c) => c.fields.scene.value)).size).toBe(
      etsy.length,
    );
    expect(
      new Set(etsy.map((c) => c.fields.composition.value)).size,
    ).toBeGreaterThan(1);
  });

  it("follows the plan's own slots, even when the shot list has changed since", () => {
    const etsy = plan.destinations[0];
    const edited = {
      destinations: [
        {
          ...etsy,
          slots: [
            ...etsy.slots.filter((s) => s.key !== "gift"),
            {
              key: "retired",
              label: "A slot the list no longer has",
              purpose: "Kept from an older plan.",
              fill: "scene" as const,
            },
          ],
        },
      ],
    };
    const built = slotCards(edited, master, productUnderstanding(board), []);
    expect(built.map((c) => c.id)).toContain("etsy.retired");
    expect(built.map((c) => c.id)).not.toContain("etsy.gift");
    expect(built.find((c) => c.id === "etsy.retired")?.direction).toBe(
      "A slot the list no longer has",
    );
  });
});

describe("startEditorState", () => {
  it("opens in generation with the spec understanding and no paid step", () => {
    const state = startEditorState({
      product: board,
      type: "launch",
      plan,
      master,
    });
    expect(state.phase).toBe("generation");
    expect(state.understanding?.subject).toContain('"The Riveras"');
    expect(state.cards).toHaveLength(8);
    expect(state.name).toBe("Engraved family cutting board — Launch");
  });

  it("without a reference image there are no cards yet", () => {
    const state = startEditorState({
      product: board,
      type: "launch",
      plan,
      master: null,
    });
    expect(state.cards).toEqual([]);
    expect(state.master).toBeNull();
  });

  it("project names fit the 80-character limit", () => {
    expect(
      projectName({ ...board, name: "x".repeat(100) }, "listing-kit").length,
    ).toBe(80);
  });
});

describe("photoReference", () => {
  it("uses an absolute raster photo as the anchor", () => {
    expect(photoReference(board)).toMatchObject({
      origin: "product",
      mime: "image/jpeg",
    });
  });

  it("refuses SVGs, relative paths and non-photo sources", () => {
    const photo = (assetUrl: string) =>
      photoReference({ ...board, source: { kind: "photo", assetUrl } });
    expect(photo("https://cdn.example.com/board.svg")).toBeNull();
    expect(photo("/files/board.png")).toBeNull();
    expect(photoReference({ ...board, source: { kind: "form" } })).toBeNull();
  });
});

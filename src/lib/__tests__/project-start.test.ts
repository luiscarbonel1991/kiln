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
      "Scale & size",
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
  const cards = slotCards(plan, master, productUnderstanding(board));

  it("one draft card per scene slot, ids unique across destinations", () => {
    expect(cards.map((c) => c.id)).toEqual([
      "etsy.hero",
      "etsy.in-use",
      "etsy.scale",
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
    expect(hook?.fields.scene.value).toContain("stop the scroll");
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
    expect(state.cards).toHaveLength(9);
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

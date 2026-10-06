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
  const cards = slotCards(plan, master, productUnderstanding(board), board);
  const scene = (id: string) =>
    cards.find((c) => c.id === id)?.fields.scene.value ?? "";

  it("one draft card per scene slot, ids unique across destinations", () => {
    expect(cards.map((c) => c.id)).toEqual([
      "etsy.hero",
      "etsy.in-use",
      "etsy.lifestyle",
      "etsy.detail",
      "etsy.gift",
      "etsy.video",
      "instagram.hook",
      "instagram.in-place",
      "instagram.detail",
    ]);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    expect(cards.every((c) => c.status === "draft")).toBe(true);
  });

  it("the video slot gets a video card, drafted on the default video model at 9:16", () => {
    const video = cards.find((c) => c.id === "etsy.video");
    expect(video).toMatchObject({
      type: "video",
      direction: "Listing video",
      status: "draft",
      model: {
        provider: "google",
        model: "veo-3.1-fast-generate-preview",
        resolution: "720p",
        aspect: "9:16",
      },
      video: { durationSec: 8, startFrameAssetId: null },
    });
  });

  it("each card resolves its recipe and keeps its slot's aspect and label", () => {
    const hook = cards.find((c) => c.id === "instagram.hook");
    expect(hook?.recipeId).toBe("instagram-carousel@instagram");
    expect(findRecipe(hook?.recipeId ?? "")).toBeDefined();
    expect(hook?.direction).toBe("Hook");
    expect(hook?.model.aspect).toBe("4:5");
    expect(hook?.fields.scene.value).toBe(
      "the product at a kitchen counter during dinner prep, styled and inviting, its whole face and design in clear view: any object of the scene sits beside it, never on top of it or covering it",
    );
  });

  it("the hook keeps the design in view, whatever its place of use holds", () => {
    const coaster = slotCards(plan, master, productUnderstanding(board), {
      ...board,
      useContexts: ["a coffee table, under a steaming mug"],
    });
    const hook = coaster.find((c) => c.id === "instagram.hook");
    expect(hook?.fields.scene.value).toContain("under a steaming mug");
    expect(hook?.fields.scene.value).toContain(
      "never on top of it or covering it",
    );
    expect(hook?.fields.composition.value).toContain("space across the top");
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

  it("scenes in a place of use keep the product's real size, readable, standing out", () => {
    const inUse = cards.find((c) => c.id === "etsy.in-use");
    const composition = inUse?.fields.composition.value ?? "";
    expect(composition).toContain(
      "the product true to its real size (16 x 10 in, larger than a letter sheet) against every object around it",
    );
    expect(composition).toContain(
      "never enlarged beyond its real size: frame closer to it instead",
    );
    // Maple is a light face.
    expect(composition).toContain(
      "its light face set against a darker background",
    );
    // The studio shots (hero, detail) are not set in a place: no cues.
    for (const id of ["etsy.hero", "etsy.detail"]) {
      const c = cards.find((card) => card.id === id);
      expect(c?.fields.composition.value).not.toContain("real size");
    }
  });

  it("the macro shows the product's treatment and keeps its words whole", () => {
    const detail = cards.find((c) => c.id === "etsy.detail");
    const composition = detail?.fields.composition.value ?? "";
    // The board is engraved: seen nearly straight on, flush.
    expect(composition).toContain("the engraving flush with the face");
    expect(composition).toContain("never cut at the frame's edge");
    expect(composition).not.toContain("{surface}");
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
    const built = slotCards(edited, master, productUnderstanding(board), {
      ...board,
      useContexts: [],
    });
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

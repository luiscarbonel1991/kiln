import { describe, expect, it } from "vitest";
import {
  contrastInk,
  exactView,
  NEUTRAL_INK,
  productOutline,
  renderTextTemplate,
  scaleReference,
  shopLine,
  textLayerColours,
} from "@/domain/exact";
import { defaultSwatch } from "@/domain/product";
import { productUnderstanding } from "@/domain/product-understanding";
import { CUTTING_BOARD } from "./fixtures/cutting-board";
import { PLATE_ON_BASE } from "./fixtures/plate-on-base";

describe("renderTextTemplate", () => {
  it("fills known tokens and leaves unknown ones visible", () => {
    expect(
      renderTextTemplate(
        "{product.name} · {product.dimensions} · {colours.count} · {nope}",
        CUTTING_BOARD,
      ),
    ).toBe("Engraved family cutting board · 16 x 10 in · 3 · {nope}");
  });

  it("hook and call to action come from the product, with fallbacks", () => {
    const written = {
      ...CUTTING_BOARD,
      hook: "Your family name, carved to last",
      cta: "Order yours",
    };
    expect(renderTextTemplate("{product.hook}|{product.cta}", written)).toBe(
      "Your family name, carved to last|Order yours",
    );
    // No hook: the name. No CTA: personalize only when there is wording.
    expect(
      renderTextTemplate("{product.hook}|{product.cta}", CUTTING_BOARD),
    ).toBe("Engraved family cutting board|Personalize yours");
    expect(
      renderTextTemplate("{product.cta}", { ...CUTTING_BOARD, wording: [] }),
    ).toBe("Shop the collection");
  });
});

describe("exactView", () => {
  it("colour grid lists every colour, out-of-stock included", () => {
    const view = exactView("colour-grid", CUTTING_BOARD);
    expect(view).toMatchObject({ title: "Available in 3 colours" });
    const one = { ...CUTTING_BOARD, colours: [CUTTING_BOARD.colours[0]] };
    expect(exactView("colour-grid", one)).toMatchObject({
      title: "Available in 1 colour",
    });
    if (view.kind !== "colour-grid") throw new Error();
    expect(view.swatches.map((s) => s.key)).toEqual([
      "maple",
      "walnut",
      "cherry",
    ]);
  });

  it("size & spec carries the real dimensions and the finish", () => {
    const view = exactView("size-spec", CUTTING_BOARD);
    if (view.kind !== "size-spec") throw new Error();
    expect([view.width, view.height, view.depth, view.unit]).toEqual([
      16,
      10,
      0.75,
      "in",
    ]);
    expect(view.title).toBe("16 x 10 in");
    expect(view.facts).toContainEqual({ label: "Finish", value: "Engraved" });
    // The product itself is drawn, and no internal field reaches the buyer.
    expect(view.product).toMatchObject({ width: 16, height: 10, round: false });
    expect(view.facts.map((f) => f.label)).toEqual([
      "Shape",
      "Material",
      "Finish",
    ]);
  });

  it("personalize mirrors the wording lines; a text template overrides the title", () => {
    const view = exactView(
      "personalize",
      CUTTING_BOARD,
      "Yours, {product.family}",
    );
    if (view.kind !== "personalize") throw new Error();
    expect(view.title).toBe("Yours, Kitchen");
    expect(view.lines.map((l) => [l.label, l.maxChars, l.required])).toEqual([
      ["Family name", 14, true],
      ["Year", 4, false],
    ]);
  });
});

describe("size & spec of a product with parts", () => {
  it("titles what the buyer buys, a row per part, the drawing measured overall", () => {
    const view = exactView("size-spec", PLATE_ON_BASE);
    if (view.kind !== "size-spec") throw new Error();
    expect(view.title).toBe("8 x 2.5 in");
    expect(view).toMatchObject({ width: 9, height: 2.78, overall: true });
    expect(view).not.toHaveProperty("depth");
    expect(view.facts).toEqual([
      { label: "Shape", value: "name plate" },
      { label: "Material", value: "hardwood" },
      { label: "plate", value: "8 x 2.5 in, 0.14 in thick" },
      {
        label: "base",
        value: "9 x 2.25 in footprint, 1/4 in thick, black matte",
      },
      { label: "Finish", value: "Engraved" },
    ]);
  });

  it("leaves out a shape or material too long for one line", () => {
    const view = exactView("size-spec", {
      ...PLATE_ON_BASE,
      shape:
        "a rectangular name plate with rounded corners standing upright in a base",
    });
    if (view.kind !== "size-spec") throw new Error();
    expect(view.facts.map((f) => f.label)).not.toContain("Shape");
  });
});

describe("productUnderstanding", () => {
  const u = productUnderstanding(CUTTING_BOARD);

  it("writes the subject from the spec, wording quoted verbatim", () => {
    expect(u.subject).toContain("16 x 10 in rounded rectangle board");
    expect(u.subject).toContain('"The Riveras" and "2026"');
    expect(u.subject).toContain("keep every letter");
    expect(u.subject).toContain("no other text");
  });

  it("uses the default colour for materials and palette", () => {
    expect(u.materials).toContain("maple solid hardwood");
    expect(u.palette).toEqual(["#E8D2A6", "#3B2A1E"]);
  });

  it("names the material sample, only when the default colour has one", () => {
    expect(u.materials).not.toContain("material sample");
    const sampled = {
      ...CUTTING_BOARD,
      colours: CUTTING_BOARD.colours.map((c, i) =>
        i === 0 ? { ...c, swatchUrl: "https://stub.local/maple.jpg" } : c,
      ),
    };
    expect(productUnderstanding(sampled).materials).toContain(
      "exactly the material, colour and grain of the material sample (the second image)",
    );
    expect(defaultSwatch(sampled)).toBe("https://stub.local/maple.jpg");
    expect(defaultSwatch(CUTTING_BOARD)).toBeNull();
  });

  it("names every image by its place: the sample, then each view", () => {
    const side = { label: "side" as const, url: "https://stub.local/side.png" };
    const sampled = {
      ...CUTTING_BOARD,
      colours: CUTTING_BOARD.colours.map((c, i) =>
        i === 0 ? { ...c, swatchUrl: "https://stub.local/maple.jpg" } : c,
      ),
      views: [side],
    };
    const u = productUnderstanding(sampled);
    expect(u.materials).toContain("material sample (the second image)");
    expect(u.subject).toContain(
      "the side view (the third image) shows this same product from the side: its depth and how far its marks stand from the face; nothing else is taken from it",
    );
    // Without a sample, the view is the second image.
    expect(
      productUnderstanding({ ...CUTTING_BOARD, views: [side] }).subject,
    ).toContain("the side view (the second image)");
    // A top view shows the outline and depth, not the marks.
    expect(
      productUnderstanding({
        ...CUTTING_BOARD,
        views: [{ label: "top", url: "https://stub.local/top.png" }],
      }).subject,
    ).toContain(
      "the top view (the second image) shows this same product from above: its outline and its depth; nothing else is taken from it",
    );
    // A video names no image.
    const video = productUnderstanding(sampled, { images: false });
    expect(`${video.subject} ${video.materials}`).not.toContain("image)");
  });

  it("keeps the forbidden list on the product, so a scene may hold props", () => {
    expect(productUnderstanding(CUTTING_BOARD).subject).toContain(
      "; add nothing to the product itself (no other text, no logos, no people, no extra objects on the product)",
    );
  });

  it("names each part with its size, colour and material", () => {
    expect(productUnderstanding(PLATE_ON_BASE).subject).toContain(
      "a 9 x 2.78 in overall name plate in maple hardwood, made of 2 parts: the plate (8 x 2.5 in, 0.14 in thick) and the base (9 x 2.25 in footprint, 1/4 in thick, black matte, two layers of the same sheet); every part true to its size",
    );
    expect(productUnderstanding(CUTTING_BOARD).subject).not.toContain("parts");
    expect(productUnderstanding(CUTTING_BOARD).subject).not.toContain(
      "overall",
    );
  });

  it("takes the first place of use as the use context", () => {
    expect(productUnderstanding(CUTTING_BOARD).useContext).toBe("");
    expect(
      productUnderstanding({
        ...CUTTING_BOARD,
        useContexts: ["a kitchen counter", "a dinner table"],
      }).useContext,
    ).toBe("a kitchen counter");
  });

  it("is generic: nothing about signs or acrylic", () => {
    expect(JSON.stringify(u).toLowerCase()).not.toMatch(/sign|acrylic/);
  });
});

describe("drawn to scale", () => {
  it("picks the everyday object closest in size to the product", () => {
    const ref = (w: number, h: number, unit: "in" | "mm" = "in") =>
      scaleReference({ w, h, unit }).key;
    expect(ref(4, 4)).toBe("card");
    expect(ref(5, 3)).toBe("phone");
    expect(ref(16, 10)).toBe("letter");
    expect(ref(30, 60)).toBe("door");
    expect(ref(100, 100, "mm")).toBe("card");
  });

  it("gives the reference in the product's unit", () => {
    expect(scaleReference({ w: 100, h: 100, unit: "mm" })).toMatchObject({
      name: "a credit card",
      width: 85.6,
      height: 54.1,
    });
  });

  it("the scale view carries the product's outline and its reference", () => {
    const view = exactView("scale", CUTTING_BOARD);
    if (view.kind !== "scale") throw new Error();
    expect(view.title).toBe("Shown to scale");
    expect(view.reference.key).toBe("letter");
    expect(view.product).toMatchObject({
      width: 16,
      height: 10,
      unit: "in",
      round: false,
    });
    expect(view.product.face).toMatch(/^#/);
  });

  it("an outline is round for round shapes only, and shows the example wording", () => {
    expect(
      productOutline({ ...CUTTING_BOARD, shape: "round coaster" }).round,
    ).toBe(true);
    expect(
      productOutline({ ...CUTTING_BOARD, shape: "rounded rectangle board" })
        .round,
    ).toBe(false);
    expect(productOutline(CUTTING_BOARD).wording.length).toBeGreaterThan(0);
  });

  it("ink contrasts with the colour under it", () => {
    expect(contrastInk("#FFFFFF")).toBe("#241f18");
    expect(contrastInk("#E8D2A6")).toBe("#241f18");
    expect(contrastInk("#171311")).toBe("#ffffff");
    expect(contrastInk("#c0461f")).toBe("#ffffff");
  });
});

describe("text layers and the maker's brand kit", () => {
  const brand = {
    palette: ["#2F4A3A", "#E9E1D2"],
    handle: "northwindmakers",
    url: "https://www.northwind.example/shop",
  };

  it("the call to action wears the brand's lead colour and the shop line", () => {
    const view = exactView("text-card", CUTTING_BOARD, "{product.cta}", brand);
    expect(view).toMatchObject({
      kind: "text-card",
      title: "Personalize yours",
      subtitle: "@northwindmakers · northwind.example",
      background: "#2F4A3A",
      ink: "#ffffff",
    });
  });

  it("without a brand kit: neutral ink, never Kiln's accent", () => {
    const view = exactView("text-card", CUTTING_BOARD, "{product.cta}", null);
    expect(view).toMatchObject({
      subtitle: CUTTING_BOARD.family,
      background: NEUTRAL_INK,
      ink: "#ffffff",
    });
    expect(textLayerColours(undefined).background).not.toBe("#c0461f");
  });

  it("the shop line takes what the kit has", () => {
    expect(shopLine({ palette: [], handle: "a" })).toBe("@a");
    expect(shopLine({ palette: [], url: "https://b.example" })).toBe(
      "b.example",
    );
    expect(shopLine({ palette: [] })).toBeNull();
    expect(shopLine(null)).toBeNull();
  });
});

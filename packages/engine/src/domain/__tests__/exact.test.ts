import { describe, expect, it } from "vitest";
import {
  contrastInk,
  exactView,
  productOutline,
  renderTextTemplate,
  scaleReference,
} from "@/domain/exact";
import { productUnderstanding } from "@/domain/product-understanding";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

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

  it("keeps the forbidden list on the product, so a scene may hold props", () => {
    expect(productUnderstanding(CUTTING_BOARD).subject).toContain(
      "; add nothing to the product itself (no other text, no logos, no people, no extra objects on the product)",
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

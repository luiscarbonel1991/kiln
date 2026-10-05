import { describe, expect, it } from "vitest";
import { exactView, renderTextTemplate } from "@/domain/exact";
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

import { describe, expect, it } from "vitest";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import { DOOR_TAG } from "@/domain/__tests__/fixtures/door-tag";
import { PLATE_ON_BASE } from "@/domain/__tests__/fixtures/plate-on-base";
import { Product } from "@/domain/product";
import { parseProductPackage } from "@/domain/product-package";
import { canonicalJson } from "@/lib/product-diff";
import {
  avoidOf,
  colourTextWarnings,
  editLimits,
  formFromProduct,
  keptWords,
  mergeForm,
  NEW_AVOID,
  productFromForm,
} from "@/lib/product-form";
import pkg from "../__fixtures__/product-package.json";

const parsed = parseProductPackage(pkg);
if (!parsed.ok) throw new Error("fixture package does not parse");

const merged = (product: Product, change = {}) => {
  const out = mergeForm(product, { ...formFromProduct(product), ...change });
  if ("error" in out) throw new Error(out.error);
  return out.product;
};

const formMade = productFromForm(
  {
    name: "Engraved wood name keychain",
    whatItIs: "rounded rectangle keychain tag",
    width: 2.5,
    height: 1.25,
    unit: "in",
    material: "3 mm birch plywood, natural wood grain",
    treatment: "engraved",
    colours: [
      { name: "Natural birch", hex: "#D9B98C" },
      { name: "Walnut stain", hex: "#6E4A33" },
    ],
    wording: [
      { label: "Name", example: "Sofia" },
      { label: "Date", example: "06.14.2026", required: false },
    ],
    useContexts: ["a set of house keys on an entryway table"],
    price: 12,
    views: [],
  },
  "68iy",
);

describe("editing a product", () => {
  it("opening and saving without a change gives the same product", () => {
    for (const product of [
      ...parsed.products,
      CUTTING_BOARD,
      PLATE_ON_BASE,
      DOOR_TAG,
      formMade,
    ]) {
      expect(canonicalJson(merged(product))).toBe(canonicalJson(product));
    }
  });

  it("keeps the sku when renamed, and what the form does not show", () => {
    const withInlay = Product.parse({
      ...PLATE_ON_BASE,
      colours: PLATE_ON_BASE.colours.map((c, i) =>
        i === 0 ? { ...c, edge: "#45301F", inlayName: "dark engraved" } : c,
      ),
    });
    const edited = merged(withInlay, { name: "Desk plate on a base" });
    expect(edited.sku).toBe(PLATE_ON_BASE.sku);
    expect(edited.id).toBe(PLATE_ON_BASE.id);
    expect(edited.name).toBe("Desk plate on a base");
    expect(edited.parts).toEqual(PLATE_ON_BASE.parts);
    expect(edited.colours[0]).toMatchObject({
      edge: "#45301F",
      inlayName: "dark engraved",
    });
  });

  it("gives a new colour its own key, and takes the default by row", () => {
    const form = formFromProduct(formMade);
    const edited = merged(formMade, {
      colours: [...form.colours, { name: "Natural birch", hex: "#EEDDCC" }],
      defaultColour: 2,
    });
    expect(edited.colours.map((c) => c.key)).toEqual([
      "natural-birch",
      "walnut-stain",
      "natural-birch-2",
    ]);
    expect(edited.defaultColour).toBe("natural-birch-2");
  });

  it("removes an optional field left empty, and fixes the width", () => {
    const { price: _price, ...form } = formFromProduct(formMade);
    const out = mergeForm(formMade, { ...form, width: 2.5, useContexts: [] });
    if ("error" in out) throw new Error(out.error);
    expect(out.product).not.toHaveProperty("price");
    expect(out.product.useContexts).toEqual([]);
  });

  it("keeps an imported product's long text editable at its own length", () => {
    const long = Product.parse({
      ...CUTTING_BOARD,
      material: "m".repeat(140),
    });
    expect(editLimits(long).material).toBe(140);
    expect(canonicalJson(merged(long))).toBe(canonicalJson(long));
    const out = mergeForm(long, {
      ...formFromProduct(long),
      material: "m".repeat(141),
    });
    expect("error" in out).toBe(true);
  });

  it("will not change the unit of a product with parts", () => {
    const out = mergeForm(PLATE_ON_BASE, {
      ...formFromProduct(PLATE_ON_BASE),
      unit: "mm",
    });
    expect(out).toMatchObject({ issues: [{ path: "unit" }] });
  });

  it("edits the family; an empty one keeps the stored family, and a new product without one is General", () => {
    expect(formFromProduct(CUTTING_BOARD).family).toBe(CUTTING_BOARD.family);
    expect(merged(CUTTING_BOARD, { family: "Kitchen boards" }).family).toBe(
      "Kitchen boards",
    );
    expect(merged(CUTTING_BOARD, { family: "  " }).family).toBe(
      CUTTING_BOARD.family,
    );
    expect(formMade.family).toBe("General");
    const named = productFromForm(
      { ...formFromProduct(formMade), family: "Key rings" },
      "x1",
    );
    expect(named.family).toBe("Key rings");
  });

  it("edits styles: a kept one keeps its key and outline, a new one gets its own, and the own drawing its name", () => {
    const form = formFromProduct(DOOR_TAG);
    expect(form.styles).toEqual([
      {
        key: "do-not-disturb",
        name: "Do not disturb",
        url: DOOR_TAG.styles?.[0].svgUrl,
        examples: ["Do not disturb"],
      },
    ]);
    const edited = merged(DOOR_TAG, {
      styleName: "Quiet, please",
      styles: [
        { ...form.styles?.[0], name: "Please do not disturb" },
        {
          name: "Original",
          url: "https://storage.test/products/welcome.svg",
          examples: ["", "come in", ""],
        },
      ],
    });
    expect(edited.styleName).toBe("Quiet, please");
    expect(edited.styles).toEqual([
      {
        ...DOOR_TAG.styles?.[0],
        name: "Please do not disturb",
      },
      {
        key: "original-2",
        name: "Original",
        svgUrl: "https://storage.test/products/welcome.svg",
        examples: ["", "come in"],
      },
    ]);
    expect(merged(DOOR_TAG, { styles: [] })).not.toHaveProperty("styles");
  });

  it("refuses styles without a design file, and a style's example longer than its line", () => {
    const style = {
      name: "Welcome",
      url: "https://storage.test/products/welcome.svg",
      examples: [],
    };
    expect(
      mergeForm(CUTTING_BOARD, {
        ...formFromProduct(CUTTING_BOARD),
        styles: [style],
      }),
    ).toMatchObject({ issues: [{ path: "styles" }] });
    expect(
      mergeForm(DOOR_TAG, {
        ...formFromProduct(DOOR_TAG),
        styles: [{ ...style, examples: ["x".repeat(17)] }],
      }),
    ).toMatchObject({ issues: [{ path: "styles.0.examples.0" }] });
  });

  it("names what it keeps that the form does not show", () => {
    expect(keptWords(PLATE_ON_BASE)).toContain("2 parts (plate, base)");
    expect(keptWords(formMade)).toEqual(["typeface Hanken Grotesk"]);
  });

  it("edits a layered colour's base as its inlay; a new base drops the old name", () => {
    const layered = Product.parse({
      ...formMade,
      treatment: "reveal",
      colours: formMade.colours.map((c) => ({
        ...c,
        inlay: "#FFFFFF",
        inlayName: "white",
      })),
    });
    expect(formFromProduct(layered).colours[0].base).toBe("#FFFFFF");
    expect(canonicalJson(merged(layered))).toBe(canonicalJson(layered));
    const form = formFromProduct(layered);
    const edited = merged(layered, {
      colours: form.colours.map((c, i) =>
        i === 0 ? { ...c, base: "#1f1f1f" } : c,
      ),
    });
    expect(edited.colours[0]).toMatchObject({ inlay: "#1F1F1F" });
    expect(edited.colours[0]).not.toHaveProperty("inlayName");
    expect(edited.colours[1]).toMatchObject({
      inlay: "#FFFFFF",
      inlayName: "white",
    });
    // The form shows the base, so it is not named as kept.
    expect(keptWords(layered)).toEqual(["typeface Hanken Grotesk"]);
  });

  it("edits a colour's supplier page; a stored note that is not a link stays", () => {
    const linked = Product.parse({
      ...formMade,
      colours: formMade.colours.map((c, i) => ({
        ...c,
        supplierUrl: i === 0 ? "https://supplier.example/birch" : "Rowmark 2",
      })),
    });
    const form = formFromProduct(linked);
    expect(form.colours[0].supplierUrl).toBe("https://supplier.example/birch");
    expect(form.colours[1]).not.toHaveProperty("supplierUrl");
    expect(canonicalJson(merged(linked))).toBe(canonicalJson(linked));
    const edited = merged(linked, {
      colours: form.colours.map((c, i) =>
        i === 0
          ? { ...c, supplierUrl: undefined }
          : { ...c, supplierUrl: "https://supplier.example/walnut" },
      ),
    });
    expect(edited.colours[0]).not.toHaveProperty("supplierUrl");
    expect(edited.colours[1].supplierUrl).toBe(
      "https://supplier.example/walnut",
    );
  });

  it("edits a colour's own name and material; its own things to avoid stay as imported", () => {
    const own = Product.parse({
      ...DOOR_TAG,
      name: "Engraved door tag, black & white",
      colours: DOOR_TAG.colours.map((c) =>
        c.key === "gold-black"
          ? {
              ...c,
              productName: "Engraved door tag, brushed gold",
              forbidden: ["black face"],
            }
          : c,
      ),
    });
    const form = formFromProduct(own);
    expect(form.colours[1]).toMatchObject({
      productName: "Engraved door tag, brushed gold",
    });
    expect(canonicalJson(merged(own))).toBe(canonicalJson(own));
    const edited = merged(own, {
      colours: form.colours.map((c, i) =>
        i === 1
          ? { ...c, productName: "", material: "a brushed GOLD face" }
          : c,
      ),
    });
    expect(edited.colours[1]).not.toHaveProperty("productName");
    expect(edited.colours[1]).toMatchObject({
      material: "a brushed GOLD face",
      forbidden: ["black face"],
    });
    expect(keptWords(own)).toContain("Gold/Black's own things to avoid");
  });

  it("warns on each colour row whose product text names another colour", () => {
    const own = Product.parse({
      ...DOOR_TAG,
      name: "Engraved door tag, black & white",
      forbidden: ["gold finish"],
    });
    const form = formFromProduct(own);
    const [base, gold] = colourTextWarnings(form, avoidOf(own));
    expect(base).toBeNull();
    expect(gold).toContain(
      'its name says white, and it must never show "gold finish"',
    );
    expect(gold).toContain(
      "Its things to avoid come from its package: give Gold/Black its own forbidden list there.",
    );
    // Its own name and things to avoid answer it.
    const fixed = colourTextWarnings(
      {
        ...form,
        colours: form.colours.map((c, i) =>
          i === 1 ? { ...c, productName: "Engraved door tag, gold" } : c,
        ),
      },
      { ...avoidOf(own), colours: { "gold-black": ["black face"] } },
    );
    expect(fixed).toEqual([null, null]);
    // A new row has no key yet; a new product avoids only the defaults.
    expect(
      colourTextWarnings(
        {
          ...form,
          colours: [...form.colours, { name: "Silver/Black", hex: "#C0C0C0" }],
        },
        NEW_AVOID,
      )[2],
    ).toContain("its name says white");
  });
});

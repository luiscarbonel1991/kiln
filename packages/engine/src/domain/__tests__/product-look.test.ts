import { describe, expect, it } from "vitest";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import { DOOR_TAG } from "@/domain/__tests__/fixtures/door-tag";
import { Product, ProductStyle } from "@/domain/product";
import {
  lookLabel,
  productInLook,
  resolveLook,
  storedLook,
  styleName,
} from "@/domain/product-look";
import { productUnderstanding } from "@/domain/product-understanding";

describe("resolveLook", () => {
  it("takes the frame's look over the project's, and the product's default under both", () => {
    expect(resolveLook(DOOR_TAG)).toEqual({
      colour: "black-white",
      style: null,
    });
    expect(
      resolveLook(
        DOOR_TAG,
        { colour: "gold-black" },
        { colour: "black-white", style: "do-not-disturb" },
      ),
    ).toEqual({ colour: "gold-black", style: "do-not-disturb" });
  });

  it("lets a frame show the own drawing under a project in another style", () => {
    const look = resolveLook(
      DOOR_TAG,
      { style: "original" },
      { style: "do-not-disturb" },
    );
    expect(look.style).toBeNull();
    expect(storedLook(look)).toEqual({
      colour: "black-white",
      style: "original",
    });
  });

  it("passes over a colour or style the product no longer offers", () => {
    expect(
      resolveLook(
        DOOR_TAG,
        { colour: "copper", style: "gone" },
        { colour: "gold-black" },
      ),
    ).toEqual({ colour: "gold-black", style: null });
  });

  it("offers no style on a product that is not drawn from an SVG", () => {
    const board = Product.parse({
      ...CUTTING_BOARD,
      styles: DOOR_TAG.styles,
    });
    expect(resolveLook(board, { style: "do-not-disturb" }).style).toBeNull();
  });
});

describe("productInLook", () => {
  it("makes the look's colour the default, and the style's drawing and wording its own", () => {
    const shown = productInLook(DOOR_TAG, {
      colour: "gold-black",
      style: "do-not-disturb",
    });
    expect(shown.defaultColour).toBe("gold-black");
    expect(shown.wording.map((w) => w.example)).toEqual([
      "Do not disturb",
      "baby sleeping",
    ]);
    expect(shown.source).toEqual({
      kind: "vector",
      svgUrl: DOOR_TAG.styles?.[0].svgUrl,
      outlineBox: { x: 0, y: 0, w: 1, h: 0.94 },
    });
  });

  it("draws from the redrawn design, keeping the outline and the source's scale", () => {
    const shown = productInLook(
      DOOR_TAG,
      { colour: "gold-black", style: null },
      "https://storage.test/products/gold-tag.svg",
    );
    expect(shown.source).toEqual({
      kind: "vector",
      svgUrl: "https://storage.test/products/gold-tag.svg",
      scalePxPerUnit: 100,
      outlineBox: { x: 0, y: 0, w: 1, h: 1 },
    });
  });

  it("reads the colour's own name, material and things never shown, where it has them", () => {
    const own = Product.parse({
      ...DOOR_TAG,
      name: "Engraved door tag, black & white",
      material: "two-tone laminate, a satin BLACK face reading WHITE",
      forbidden: ["other text", "gold or metallic finish"],
      colours: DOOR_TAG.colours.map((c) =>
        c.key === "gold-black"
          ? {
              ...c,
              productName: "Engraved door tag, brushed gold",
              material: "two-tone laminate, a brushed GOLD face reading BLACK",
              forbidden: ["other text", "black face"],
            }
          : c,
      ),
    });
    const gold = productInLook(own, { colour: "gold-black", style: null });
    expect(gold).toMatchObject({
      name: "Engraved door tag, brushed gold",
      material: "two-tone laminate, a brushed GOLD face reading BLACK",
      forbidden: ["other text", "black face"],
    });
    const u = productUnderstanding(gold);
    expect(u.subject).toContain("Engraved door tag, brushed gold:");
    expect(u.subject).toContain("no black face");
    expect(`${u.subject} ${u.materials}`).not.toMatch(/WHITE|metallic/);
    // A colour without text of its own reads the product's.
    expect(
      productInLook(own, { colour: "black-white", style: null }),
    ).toMatchObject({ name: own.name, material: own.material });
  });

  it("writes the understanding in the look's colour, with that colour's sample", () => {
    const u = productUnderstanding(
      productInLook(DOOR_TAG, { colour: "gold-black", style: null }),
    );
    expect(u.palette).toEqual(["#D3B66F", "#1A1918"]);
    expect(u.subject).toContain('"Quiet please"');
  });
});

describe("names", () => {
  it("names a look by its colour, and its style when the product has styles", () => {
    expect(
      lookLabel(DOOR_TAG, { colour: "gold-black", style: "do-not-disturb" }),
    ).toBe("Gold/Black · Do not disturb");
    expect(lookLabel(DOOR_TAG, { colour: "black-white", style: null })).toBe(
      "Black/White · Quiet please",
    );
    expect(lookLabel(CUTTING_BOARD, { colour: "walnut", style: null })).toBe(
      "Walnut",
    );
    expect(
      styleName(Product.parse({ ...DOOR_TAG, styleName: undefined }), null),
    ).toBe("Original");
  });

  it("keeps the own drawing's key for itself", () => {
    expect(
      ProductStyle.safeParse({ ...DOOR_TAG.styles?.[0], key: "original" })
        .success,
    ).toBe(false);
  });
});

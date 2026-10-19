import { describe, expect, it } from "vitest";
import { listingDraft } from "@/domain/listing";
import { Product } from "@/domain/product";
import { SEED_DESTINATIONS } from "@/domain/seed";
import { listingSheet } from "@/server/deliver/listing-sheet";

const rules = SEED_DESTINATIONS.find((d) => d.id === "etsy")?.text;
if (!rules) throw new Error("Etsy has no text rules");

const product = Product.parse({
  id: "x",
  sku: "LS-01",
  name: "Engraved slate coaster",
  family: "Home",
  dimensions: { w: 4, h: 4 },
  shape: "square coaster",
  material: "natural slate",
  treatment: "engraved",
  colours: [
    { key: "grey", name: "Grey", face: "#555555" },
    { key: "black", name: "Black", face: "#111111", inStock: false },
  ],
  defaultColour: "grey",
  typography: { family: "Hanken Grotesk" },
  wording: [{ label: "Initials", maxChars: 3 }],
  variants: [
    {
      name: "Set",
      values: [
        { key: "1", label: "Single", priceExtra: 0 },
        { key: "4", label: "Set of 4", priceExtra: 30 },
      ],
    },
  ],
  price: 14,
  source: { kind: "form" },
});

describe("listingSheet", () => {
  it("lays every field out in the order of the channel's editor, pasted verbatim", () => {
    const sheet = listingSheet({
      channel: "Etsy",
      product,
      listing: listingDraft(product, rules),
      rules,
    });
    const order = [
      "[1] TITLE",
      "[2] DESCRIPTION",
      "[3] PRICE AND VARIATIONS",
      "[4] PERSONALIZATION (1 field)",
      "[5] TAGS",
      "[6] MATERIALS",
      "[7] ATTRIBUTES",
    ].map((h) => sheet.indexOf(h));
    expect(
      order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
    ).toBe(true);
    expect(sheet).toContain("Type 1 — Set   Prices vary: on");
    expect(sheet).toContain("Set of 4 — 44.00");
    expect(sheet).toContain("Black (out of stock: quantity 0)");
    expect(sheet).toContain(
      "Field 1 — Title: Initials   Required: Yes   Character limit: 3",
    );
    expect(sheet).toContain("Kiln never publishes");
    expect(sheet).not.toContain("FIX BEFORE PUBLISHING");
  });

  it("puts what still breaks a rule at the top", () => {
    const { price: _price, ...unpriced } = product;
    const sheet = listingSheet({
      channel: "Etsy",
      product: unpriced,
      listing: {
        ...listingDraft(unpriced, rules),
        tags: { value: ["a tag that is far too long"], source: "maker" },
      },
      rules,
    });
    const top = sheet.slice(0, sheet.indexOf("[1] TITLE"));
    expect(top).toContain("FIX BEFORE PUBLISHING");
    expect(top).toContain("- price:");
    expect(top).toContain('"a tag that is far too long" has 26 characters');
  });
});

import { describe, expect, it } from "vitest";
import { ProjectPlan } from "@/domain/plan";
import { Product } from "@/domain/product";
import { storyProduct, storyWords } from "@/lib/product-story";
import pkg from "../__fixtures__/product-package.json";

const product = Product.parse({ ...pkg.products[0], price: 48 });

describe("a product as a reader is told it", () => {
  it("gives its facts in a buyer's words", () => {
    const told = storyProduct(product);
    expect(told).toMatchObject({
      name: product.name,
      sku: product.sku,
      material: product.material,
      price: 48,
    });
    expect(told.size).toMatch(/ in$/);
    expect(told.colours.map((c) => c.key)).toEqual(
      product.colours.map((c) => c.key),
    );
    expect(told.wording.map((w) => w.label)).toEqual(
      product.wording.map((w) => w.label),
    );
  });

  it("drafts the listing's words from the spec, to the first text channel's limits", () => {
    const words = storyWords(product, undefined);
    expect(words).toMatchObject({ channel: "Etsy", titleMax: 140, tagMax: 13 });
    expect(words?.title.length).toBeGreaterThan(0);
    expect(words?.title.length).toBeLessThanOrEqual(140);
    expect(words?.tags.length).toBeLessThanOrEqual(13);
  });

  it("tells a destination's saved listing, its description cut to two paragraphs", () => {
    const plan = ProjectPlan.parse({
      destinations: [
        {
          destinationId: "etsy",
          shotListId: "etsy-listing",
          slots: [{ key: "hero", label: "hero", purpose: "p", aspect: "4:5" }],
          listing: {
            title: { value: "Walnut board, carved", source: "maker" },
            description: { value: "One.\n\nTwo.\n\nThree.", source: "spec" },
            tags: { value: ["walnut board"], source: "spec" },
            materials: { value: [], source: "spec" },
            personalization: { value: [], source: "spec" },
          },
        },
      ],
    });
    expect(storyWords(product, plan.destinations[0])).toMatchObject({
      channel: "Etsy",
      title: "Walnut board, carved",
      description: "One.\n\nTwo.",
      tags: ["walnut board"],
    });
  });
});

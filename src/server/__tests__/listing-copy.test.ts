import { describe, expect, it } from "vitest";
import { listingDraft } from "@/domain/listing";
import { Product } from "@/domain/product";
import { SEED_DESTINATIONS } from "@/domain/seed";
import { writeListing } from "@/server/text-calls";

const rules = SEED_DESTINATIONS.find((d) => d.id === "etsy")?.text;
if (!rules) throw new Error("Etsy has no text rules");
const product = Product.parse({
  id: "x",
  sku: "LC-01",
  name: "Listing copy coaster",
  family: "Home",
  dimensions: { w: 4, h: 4 },
  shape: "round coaster",
  material: "slate",
  treatment: "engraved",
  colours: [{ key: "grey", name: "Grey", face: "#555555" }],
  defaultColour: "grey",
  typography: { family: "Hanken Grotesk" },
  price: 18,
  source: { kind: "form" },
});

describe("writeListing", () => {
  it("says why it could not write, and offers the other provider with its price", async () => {
    const result = await writeListing(
      {
        channel: "Etsy",
        product,
        rules,
        draft: listingDraft(product, rules),
      },
      { provider: "openai", model: "gpt-6.1-sol" },
    );
    expect(result.copy).toBeUndefined();
    expect(result.degraded).toMatchObject({
      provider: "openai",
      model: "gpt-6.1-sol",
      alternative: { provider: "google", usd: expect.any(Number) },
    });
  });
});

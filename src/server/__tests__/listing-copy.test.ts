import { describe, expect, it, vi } from "vitest";
import { listingDraft } from "@/domain/listing";
import { Product } from "@/domain/product";
import { SEED_DESTINATIONS } from "@/domain/seed";
import { writeListing } from "@/server/text-calls";

// Kiln's defaults, never the shared test maker's saved routes: the
// maker-repository suite writes them while other files run.
vi.mock("@/server/maker-repository", async (original) => {
  const { DEFAULT_MAKER_MODELS } = await import("@/domain/model-defaults");
  return {
    ...(await original<typeof import("@/server/maker-repository")>()),
    getMakerModelSetup: async () => ({
      models: DEFAULT_MAKER_MODELS,
      routes: null,
      agents: {},
    }),
  };
});

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

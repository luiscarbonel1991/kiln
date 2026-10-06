import { describe, expect, it } from "vitest";
import { importProductsAction } from "@/app/actions/products";

const product = (source: unknown) => ({
  id: "assets:AS-01",
  sku: "AS-01",
  name: "Asset test coaster",
  family: "Home",
  dimensions: { w: 4, h: 4, unit: "in" },
  shape: "round coaster",
  material: "birch",
  treatment: "engraved",
  colours: [{ key: "natural", name: "Natural", face: "#D9B98C" }],
  defaultColour: "natural",
  typography: { family: "Hanken Grotesk" },
  source,
});

describe("importProductsAction", () => {
  it("refuses a package whose asset lives where Kiln does not fetch, before saving anything", async () => {
    const result = await importProductsAction({
      products: [
        product({
          kind: "vector",
          svgUrl: "http://169.254.169.254/latest/plate.svg",
        }),
      ],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toContain('sku "AS-01"');
    expect(!result.ok && result.errors[0]).toContain("KILN_ASSET_ORIGINS");
  });
});

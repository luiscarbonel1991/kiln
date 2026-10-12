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
  it("sets aside a product whose asset lives where Kiln does not fetch, before saving anything", async () => {
    const result = await importProductsAction({
      products: [
        product({
          kind: "vector",
          svgUrl: "http://169.254.169.254/latest/plate.svg",
        }),
      ],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.imported).toEqual([]);
    expect(result.rejected[0].label).toBe('"AS-01" Asset test coaster');
    expect(result.rejected[0].errors[0]).toContain("KILN_ASSET_ORIGINS");
  });

  it("sets aside a product whose material sample lives where Kiln does not fetch", async () => {
    const result = await importProductsAction({
      products: [
        {
          ...product({ kind: "form" }),
          colours: [
            {
              key: "natural",
              name: "Natural",
              face: "#D9B98C",
              swatchUrl: "http://169.254.169.254/oak.jpg",
            },
          ],
        },
      ],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.imported).toEqual([]);
    expect(result.rejected[0].errors[0]).toMatch(
      /^colours › natural › swatchUrl: .*KILN_ASSET_ORIGINS/,
    );
  });
});

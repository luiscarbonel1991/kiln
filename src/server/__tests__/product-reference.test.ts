import { afterEach, describe, expect, it, vi } from "vitest";

const render = vi.hoisted(() => ({
  result: null as null | {
    assetUrl: string;
    mime: "image/png";
    angleDeg: number;
  },
  fail: false,
  calls: 0,
}));
vi.mock("@/providers/plates/three-quarter", () => ({
  renderThreeQuarter: async () => {
    render.calls++;
    if (render.fail) throw new Error("resvg failed");
    return render.result;
  },
}));

const { threeQuarterReference } = await import("@/server/product-reference");
const { Product } = await import("@/domain/product");

const product = Product.parse({
  id: "prod-1",
  sku: "DP-1",
  name: "Desk plate on a base",
  family: "Office",
  dimensions: { w: 9, h: 2.78, d: 2.25, unit: "in" },
  shape: "name plate",
  material: "maple plywood",
  treatment: "engraved",
  colours: [{ key: "maple", name: "Maple", face: "#E8D2A6" }],
  defaultColour: "maple",
  typography: { family: "Fraunces" },
  source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
});
const plate = {
  id: "plate-prod-1",
  origin: "product" as const,
  sourcePrompt: null,
  assetUrl: "https://stub.local/plates/front.png",
  mime: "image/png",
};

afterEach(() => {
  render.result = null;
  render.fail = false;
  render.calls = 0;
});

describe("threeQuarterReference", () => {
  it("draws the view from above beside Kiln's own plate", async () => {
    render.result = {
      assetUrl: "https://stub.local/plates/above.png",
      mime: "image/png",
      angleDeg: 30,
    };
    expect(await threeQuarterReference(product, plate)).toEqual({
      assetUrl: "https://stub.local/plates/above.png",
      angleDeg: 30,
      front: plate.assetUrl,
    });
  });

  it("none beside a photo or a maker's reference, and none when the drawing is refused or fails", async () => {
    render.result = {
      assetUrl: "https://stub.local/plates/above.png",
      mime: "image/png",
      angleDeg: 30,
    };
    expect(
      await threeQuarterReference(product, { ...plate, id: "product-prod-1" }),
    ).toBeNull();
    expect(await threeQuarterReference(product, null)).toBeNull();
    expect(render.calls).toBe(0);
    render.result = null;
    expect(await threeQuarterReference(product, plate)).toBeNull();
    render.fail = true;
    expect(await threeQuarterReference(product, plate)).toBeNull();
  });
});

import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

// Storage stubbed in memory; data: images are read as they are.
const storage = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  stored: [] as { mime: string; prefix: string; byContent?: boolean }[],
}));
vi.mock("@/providers/asset-bytes", async (original) => {
  const real = await original<typeof import("@/providers/asset-bytes")>();
  return {
    ...real,
    fetchAsset: async (url: string) => {
      const bytes = storage.files.get(url);
      if (!bytes) return real.fetchAsset(url);
      return {
        bytes: Buffer.from(bytes),
        base64: Buffer.from(bytes).toString("base64"),
        mime: url.endsWith(".svg") ? "image/svg+xml" : "image/png",
      };
    },
    storeAsset: async (
      bytes: Uint8Array,
      mime: string,
      prefix: string,
      options?: { byContent?: boolean },
    ) => {
      storage.stored.push({ mime, prefix, byContent: options?.byContent });
      const url = `https://stub.local/${prefix}/${storage.files.size}.${mime === "image/svg+xml" ? "svg" : "png"}`;
      storage.files.set(url, bytes);
      return url;
    },
  };
});

const { drawLook } = await import("@/server/product-reference");
const { DOOR_TAG, dataSvg, doorTagSvg } = await import(
  "@/domain/__tests__/fixtures/door-tag"
);
const { CUTTING_BOARD } = await import(
  "@/domain/__tests__/fixtures/cutting-board"
);
const { Product } = await import("@/domain/product");

// The colour of one pixel of a stored PNG (real ImageMagick).
const pixel = (url: string, x: number, y: number) =>
  [
    ...execFileSync(
      "magick",
      ["-", "-crop", `1x1+${x}+${y}`, "-depth", "8", "rgb:-"],
      { input: storage.files.get(url) },
    ),
  ]
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");

describe("drawLook", () => {
  it("draws the product's own design in its default colour, as it is", async () => {
    const drawn = await drawLook(DOOR_TAG, {
      colour: "black-white",
      style: null,
    });
    if ("refused" in drawn) throw new Error(drawn.refused);
    expect(drawn.design).toBe(
      DOOR_TAG.source.kind === "vector" && DOOR_TAG.source.svgUrl,
    );
    expect(drawn).not.toHaveProperty("style");
    // The plate's centre row, left of the marks: the face.
    expect(pixel(drawn.front, 150, 512)).toBe("1b1b1b");
  });

  it("redraws a style in another colour, stores the design by its bytes, and draws its plate", async () => {
    storage.stored.length = 0;
    const drawn = await drawLook(DOOR_TAG, {
      colour: "gold-black",
      style: "do-not-disturb",
    });
    if ("refused" in drawn) throw new Error(drawn.refused);
    expect(drawn.style).toBe("do-not-disturb");
    expect(storage.stored[0]).toEqual({
      mime: "image/svg+xml",
      prefix: "products",
      byContent: true,
    });
    const design = Buffer.from(
      storage.files.get(drawn.design) ?? new Uint8Array(),
    ).toString("utf8");
    expect(design).toContain('fill="#D3B66F"');
    expect(pixel(drawn.front, 150, 512)).toBe("d3b66f");
    expect(drawn.threeQuarter).toBeUndefined();
  });

  it("refuses a colour Kiln cannot swap in, and a product with no design file", async () => {
    const odd = Product.parse({
      ...DOOR_TAG,
      styles: undefined,
      source: {
        kind: "vector",
        svgUrl: dataSvg(doorTagSvg("#123456", "#000000", "#FFFFFF")),
      },
    });
    expect(await drawLook(odd, { colour: "gold-black", style: null })).toEqual({
      refused:
        "Kiln cannot redraw this design in Gold/Black: its drawing paints none of the product's colours.",
    });
    // Its default colour is drawn as it always was.
    expect(
      await drawLook(odd, { colour: "black-white", style: null }),
    ).toHaveProperty("front");
    expect(
      await drawLook(CUTTING_BOARD, { colour: "walnut", style: null }),
    ).toEqual({
      refused:
        "Kiln draws other colours and styles from a design file; this product has none.",
    });
  });
});

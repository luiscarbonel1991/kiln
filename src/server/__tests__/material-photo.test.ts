import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { rasterType } from "@/domain/image-type";
import { colourDifference } from "@/lib/material-check";

// Storage stubbed: a stored sample is read from memory, and a corrected one is
// "stored" under a name from its size.
const storage = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  stored: [] as { mime: string; byContent?: boolean }[],
}));
vi.mock("@/providers/asset-bytes", async (original) => ({
  ...(await original<typeof import("@/providers/asset-bytes")>()),
  fetchAsset: async (url: string) => {
    const bytes = storage.files.get(url);
    if (!bytes) throw new Error(`no file at ${url}`);
    return { bytes: Buffer.from(bytes), base64: "", mime: "image/png" };
  },
  storeAsset: async (
    bytes: Uint8Array,
    mime: string,
    _folder: string,
    options?: { byContent?: boolean },
  ) => {
    storage.stored.push({ mime, byContent: options?.byContent });
    const url = `https://stub.local/products/${bytes.length}`;
    storage.files.set(url, bytes);
    return url;
  },
}));

const { balanceWhite, correctSample, matchSwatch, readSample } = await import(
  "@/server/material-photo"
);
const { photoColours } = await import("@/server/product-files");

// Real ImageMagick on synthetic photos: a sample of a warm wood with a sheet of
// paper in its top left corner, shot under warm light.
const image = (args: string[]) =>
  new Uint8Array(execFileSync("magick", args, { maxBuffer: 16 << 20 }));

const WARM_SAMPLE = [
  "-size",
  "200x200",
  "xc:#B08A5E",
  "-fill",
  "#ECD4B0",
  "-draw",
  "rectangle 0,0 59,59",
];

// The colour of one pixel of an encoded photo.
const pixel = (bytes: Uint8Array, x: number, y: number) =>
  [
    ...execFileSync(
      "magick",
      ["-", "-crop", `1x1+${x}+${y}`, "-depth", "8", "rgb:-"],
      { input: bytes },
    ),
  ].slice(0, 3);

describe("balanceWhite", () => {
  it("makes the tapped paper neutral and keeps the photo's format", async () => {
    const jpeg = image([...WARM_SAMPLE, "-quality", "95", "jpeg:-"]);
    const result = await balanceWhite(jpeg, { x: 0.15, y: 0.15 });
    if ("refused" in result) throw new Error(result.refused);
    expect(result.mime).toBe("image/jpeg");
    expect(rasterType(result.bytes)).toBe("image/jpeg");
    const [r, g, b] = pixel(result.bytes, 30, 30);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(3);
    // The wood moves with it: less red against blue than before.
    const [wr, , wb] = pixel(result.bytes, 150, 150);
    expect(wr - wb).toBeLessThan(0xb0 - 0x5e);
  });

  it("refuses a spot with colour, and returns no photo", async () => {
    const png = image([...WARM_SAMPLE, "png:-"]);
    const result = await balanceWhite(png, { x: 0.75, y: 0.75 });
    expect(result).toEqual({ refused: expect.stringContaining("has colour") });
  });

  it("refuses what is not a photo", async () => {
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
    );
    expect(await balanceWhite(svg, { x: 0.5, y: 0.5 })).toEqual({
      refused: expect.stringContaining("PNG, JPEG or WebP"),
    });
  });
});

describe("matchSwatch", () => {
  it("brings a grained photo's colour to the swatch", async () => {
    const grained = image([
      "-size",
      "160x160",
      "xc:#BE956A",
      "-attenuate",
      "0.4",
      "+noise",
      "Gaussian",
      "png:-",
    ]);
    const result = await matchSwatch(grained, "#EDCFA3");
    if ("refused" in result) throw new Error(result.refused);
    expect(result.mime).toBe("image/png");
    const [after] = await photoColours(result.bytes, 1);
    expect(colourDifference(after, "#EDCFA3")).toBeLessThan(3);
  });

  it("refuses a photo too far from the swatch", async () => {
    const dark = image(["-size", "64x64", "xc:#1A1A1A", "png:-"]);
    expect(await matchSwatch(dark, "#F4F4F4")).toEqual({
      refused: expect.stringContaining("too far"),
    });
  });
});

describe("readSample and correctSample", () => {
  it("reads a stored sample's colour, and stores a corrected one by its bytes", async () => {
    const url = "https://stub.local/products/maple.png";
    storage.files.set(url, image([...WARM_SAMPLE, "png:-"]));
    const read = await readSample(url);
    expect(read).toEqual({
      url,
      colour: { name: expect.any(String), hex: "#B08A5E" },
    });

    storage.stored.length = 0;
    const balanced = await correctSample(url, { white: { x: 0.1, y: 0.1 } });
    if ("error" in balanced) throw new Error(balanced.error);
    expect(balanced.url).not.toBe(url);
    expect(storage.stored).toEqual([{ mime: "image/png", byContent: true }]);
    expect(balanced.colour?.hex).not.toBe("#B08A5E");

    const matched = await correctSample(url, { swatch: "#C9A374" });
    if ("error" in matched) throw new Error(matched.error);
    expect(colourDifference(matched.colour?.hex ?? "", "#C9A374")).toBeLessThan(
      3,
    );
  });

  it("says why, and stores nothing, when the photo cannot be read or corrected", async () => {
    storage.stored.length = 0;
    expect(await readSample("https://stub.local/missing.png")).toEqual({
      error: "That material photo could not be read.",
    });
    const url = "https://stub.local/products/sample.png";
    storage.files.set(url, image([...WARM_SAMPLE, "png:-"]));
    expect(await correctSample(url, { white: { x: 0.8, y: 0.8 } })).toEqual({
      error: expect.stringContaining("has colour"),
    });
    expect(storage.stored).toEqual([]);
  });
});

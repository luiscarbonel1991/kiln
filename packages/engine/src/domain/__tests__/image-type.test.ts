import { describe, expect, it } from "vitest";
import { imageSize, rasterType, sizeAspect } from "@/domain/image-type";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("rasterType", () => {
  it("reads PNG, JPEG and WebP from their first bytes", () => {
    expect(rasterType(PNG_1PX)).toBe("image/png");
    expect(rasterType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe(
      "image/jpeg",
    );
    expect(
      rasterType(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1")),
    ).toBe("image/webp");
  });

  it("refuses anything else, whatever it is called", () => {
    expect(
      rasterType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).toBeNull();
    expect(
      rasterType(Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt ", "latin1")),
    ).toBeNull();
    expect(rasterType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(rasterType(new Uint8Array())).toBeNull();
  });
});

const riff = (chunk: string, body: number[]) =>
  Uint8Array.from([
    ...Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP", "latin1"),
    ...Buffer.from(chunk, "latin1"),
    0,
    0,
    0,
    0,
    ...body,
  ]);

describe("imageSize", () => {
  it("reads a PNG's size from its header", () => {
    expect(imageSize(PNG_1PX)).toEqual({ width: 1, height: 1 });
    const wide = Uint8Array.from(PNG_1PX);
    wide.set([0, 0, 0x07, 0xd0, 0, 0, 0x05, 0xdc], 16);
    expect(imageSize(wide)).toEqual({ width: 2000, height: 1500 });
  });

  it("reads a JPEG's size from its frame, past the segments before it", () => {
    const jpeg = Uint8Array.from([
      0xff,
      0xd8,
      // APP0, 16 bytes
      0xff,
      0xe0,
      0x00,
      0x10,
      ...new Array(14).fill(0),
      // a Huffman table (C4 is in the frame range but is not a frame)
      0xff,
      0xc4,
      0x00,
      0x04,
      0x00,
      0x00,
      // SOF2 (progressive): precision, height 1200, width 1600
      0xff,
      0xc2,
      0x00,
      0x11,
      0x08,
      0x04,
      0xb0,
      0x06,
      0x40,
      0x03,
      0,
      0,
      0,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 1600, height: 1200 });
  });

  it("reads lossy, lossless and extended WebP", () => {
    const lossy = riff(
      "VP8 ",
      [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 0x03, 0x58, 0x02],
    );
    expect(imageSize(lossy)).toEqual({ width: 800, height: 600 });
    // 14 bits each: width - 1 = 799, height - 1 = 599.
    const bits = 799 | (599 << 14);
    const lossless = riff("VP8L", [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >>> 24) & 0xff,
      0,
      0,
      0,
      0,
    ]);
    expect(imageSize(lossless)).toEqual({ width: 800, height: 600 });
    const extended = riff("VP8X", [0, 0, 0, 0, 0x1f, 0x03, 0, 0x57, 0x02, 0]);
    expect(imageSize(extended)).toEqual({ width: 800, height: 600 });
  });

  it("is null for what is not a raster, or a header cut short", () => {
    expect(imageSize(Buffer.from("<svg/>"))).toBeNull();
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(imageSize(PNG_1PX.subarray(0, 20))).toBeNull();
  });
});

describe("sizeAspect", () => {
  it("is the size's ratio in lowest terms", () => {
    expect(sizeAspect({ width: 2000, height: 1500 })).toBe("4:3");
    expect(sizeAspect({ width: 1080, height: 1350 })).toBe("4:5");
    expect(sizeAspect({ width: 2000, height: 1599 })).toBe("2000:1599");
  });
});

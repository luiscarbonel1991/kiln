import { describe, expect, it } from "vitest";
import { rasterType } from "@/lib/image-type";

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

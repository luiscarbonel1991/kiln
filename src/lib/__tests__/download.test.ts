import { describe, expect, it } from "vitest";
import { assetFilename } from "@/lib/download";

describe("assetFilename", () => {
  it("slugs the label and picks the extension by asset type", () => {
    expect(assetFilename("Cut outline", "image")).toBe("kiln-cut-outline.jpg");
    expect(assetFilename("Cut outline", "video")).toBe("kiln-cut-outline.mp4");
    expect(assetFilename("Cut outline", "vector")).toBe("kiln-cut-outline.svg");
  });

  it("falls back to 'asset' for an empty or symbol-only label", () => {
    expect(assetFilename("!!!", "vector")).toBe("kiln-asset.svg");
  });
});

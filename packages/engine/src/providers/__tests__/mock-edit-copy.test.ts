import { afterEach, describe, expect, it, vi } from "vitest";

const fetchAsset = vi.fn(async () => ({
  bytes: Buffer.from("png-bytes"),
  mime: "image/png",
}));
const storeAsset = vi.fn(async () => "http://storage.test/cards/copy.png");
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: (...a: unknown[]) => fetchAsset(...(a as [])),
  storeAsset: (...a: unknown[]) => storeAsset(...(a as [])),
  isAllowedAssetUrl: (url: string) => !url.includes("stub.local"),
}));

const { mockEditCopy } = await import("@/providers/mock/edit-copy");

afterEach(() => vi.clearAllMocks());

describe("a mock edit", () => {
  it("returns a stored copy of the reference, so vectorize and deliver read a real image", async () => {
    const result = await mockEditCopy(
      "http://storage.test/masters/sketch.png",
      "openai",
      "gpt-image-2",
    );
    expect(result.assets[0]).toMatchObject({
      url: "http://storage.test/cards/copy.png",
      mime: "image/png",
    });
    expect(storeAsset).toHaveBeenCalledOnce();
  });

  it("gives a stub back for a reference Kiln cannot read", async () => {
    const result = await mockEditCopy(
      "https://stub.local/m.png",
      "google",
      "gemini-3.1-flash-image",
    );
    expect(result.assets[0].url).toMatch(/^https:\/\/stub\.local\/google\//);
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});

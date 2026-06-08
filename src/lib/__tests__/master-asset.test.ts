import { describe, expect, it } from "vitest";
import {
  masterAssetFromGeneration,
  masterAssetFromUpload,
} from "@/lib/master-asset";

describe("masterAssetFromUpload", () => {
  it("produces an upload-origin asset with null sourcePrompt", () => {
    const master = masterAssetFromUpload({
      assetUrl: "blob:https://app/abc",
      mime: "image/png",
    });
    expect(master.origin).toBe("upload");
    expect(master.sourcePrompt).toBeNull();
    expect(master.assetUrl).toBe("blob:https://app/abc");
    expect(master.mime).toBe("image/png");
    expect(master.id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe("masterAssetFromGeneration", () => {
  const result = {
    assets: [
      {
        id: "google-generate-mock",
        url: "https://stub.local/x.png",
        mime: "image/png",
      },
    ],
    provider: "google",
    model: "gemini-2.5-flash-image",
  };

  it("carries the prompt and the first asset's url/mime", () => {
    const master = masterAssetFromGeneration(result, "a glazed cream pitcher");
    expect(master.origin).toBe("generated");
    expect(master.sourcePrompt).toBe("a glazed cream pitcher");
    expect(master.assetUrl).toBe("https://stub.local/x.png");
    expect(master.mime).toBe("image/png");
  });

  it("throws when the result has no assets", () => {
    expect(() =>
      masterAssetFromGeneration({ ...result, assets: [] }, "x"),
    ).toThrow();
  });
});

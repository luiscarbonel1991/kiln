import { describe, expect, it } from "vitest";
import { editImage } from "@/app/actions/edit";
import type { ImageEditInput } from "@/providers/types";

function editInput(provider: "google" | "openai"): ImageEditInput {
  return {
    masterAssetUrl: "https://stub.local/master.png",
    prompt: "edit(master) -> subject",
    imageInputs: [],
    negative: "",
    model: {
      provider,
      model: "x",
      aspect: "4:5",
      guidance: 7.5,
      strength: 0.65,
    },
  };
}

describe("editImage", () => {
  it("a card saved on Google is generated on OpenAI (generation policy)", async () => {
    const result = await editImage(editInput("google"));
    expect(result.provider).toBe("openai");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].mime).toBe("image/png");
  });

  it("resolves the provider from input.model.provider (openai)", async () => {
    const result = await editImage(editInput("openai"));
    expect(result.provider).toBe("openai");
  });
});

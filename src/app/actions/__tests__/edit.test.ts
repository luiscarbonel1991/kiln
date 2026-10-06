import { describe, expect, it } from "vitest";
import { editImage } from "@/app/actions/edit";
import type { ImageEditInput } from "@/providers/types";

const MODEL = { google: "gemini-3.1-flash-image", openai: "gpt-image-2" };

function editInput(
  provider: "google" | "openai",
  model: string = MODEL[provider],
): ImageEditInput {
  return {
    masterAssetUrl: "https://stub.local/master.png",
    prompt: "edit(master) -> subject",
    imageInputs: [],
    negative: "",
    model: {
      provider,
      model,
      aspect: "4:5",
      guidance: 7.5,
      strength: 0.65,
    },
  };
}

describe("editImage", () => {
  it("a card on Google is generated on Google (never swapped)", async () => {
    const result = await editImage(editInput("google"));
    expect(result.provider).toBe("google");
    expect(result.model).toBe("gemini-3.1-flash-image");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].mime).toBe("image/png");
  });

  it("refuses a model Kiln does not offer instead of swapping it", async () => {
    await expect(editImage(editInput("openai", "made-up"))).rejects.toThrow(
      /not a image model Kiln offers/,
    );
  });

  it("resolves the provider from input.model.provider (openai)", async () => {
    const result = await editImage(editInput("openai"));
    expect(result.provider).toBe("openai");
  });
});

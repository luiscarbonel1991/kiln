import { describe, expect, it } from "vitest";
import { buildCards } from "@/domain/cards";
import { assemblePrompt, buildPlanningContext } from "@/domain/cascade";
import { buildGenerationRequest } from "@/domain/generation-request";
import type { MasterAsset } from "@/domain/master-asset";
import { SEED_BRAND, SEED_RECIPE } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";

const master: MasterAsset = {
  id: "m",
  origin: "product",
  sourcePrompt: null,
  assetUrl: "https://stub.local/plate.png",
  mime: "image/png",
};
const understanding: BaseUnderstanding = {
  subject: "engraved cutting board",
  productType: "cutting board",
  useContext: "",
  sceneProps: "",
  materials: "maple",
  lighting: "soft",
  composition: "centered",
  mood: "calm",
  palette: ["#E8D2A6"],
};
const [card] = buildCards({
  master,
  recipe: SEED_RECIPE,
  planning: buildPlanningContext(understanding, SEED_RECIPE, SEED_BRAND),
});
const context = {
  master,
  understanding,
  recipe: SEED_RECIPE,
  brand: SEED_BRAND,
};

describe("buildGenerationRequest", () => {
  it("sends exactly the assembled prompt and negative the editor shows", () => {
    const expected = assemblePrompt(
      card,
      master,
      understanding,
      SEED_RECIPE,
      SEED_BRAND,
      card.direction,
    );
    const request = buildGenerationRequest({ card, ...context });
    expect(request.prompt).toBe(expected.prompt);
    expect(request.negative).toBe(expected.negative);
    expect(request.masterAssetUrl).toBe(master.assetUrl);
  });

  it("a prompt override wins", () => {
    const request = buildGenerationRequest({
      card: { ...card, promptOverride: "hand-written" },
      ...context,
    });
    expect(request.prompt).toBe("hand-written");
  });

  it("applies the generation policy to the model (OpenAI only)", () => {
    const request = buildGenerationRequest({
      card: {
        ...card,
        model: {
          ...card.model,
          provider: "google",
          model: "gemini-3.1-flash-image",
        },
      },
      ...context,
    });
    expect(request.model).toMatchObject({
      provider: "openai",
      model: "gpt-image-2",
    });
  });
});

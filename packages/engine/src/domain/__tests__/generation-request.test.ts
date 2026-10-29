import { describe, expect, it } from "vitest";
import { buildCards } from "@/domain/cards";
import { assemblePrompt, buildPlanningContext } from "@/domain/cascade";
import {
  buildGenerationRequest,
  buildVersionRequest,
} from "@/domain/generation-request";
import type { MasterAsset } from "@/domain/master-asset";
import { SEED_BRAND, SEED_RECIPE } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

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
  avoid: "",
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

  it("keeps the card's own model, whatever its provider (never swapped)", () => {
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
      provider: "google",
      model: "gemini-3.1-flash-image",
    });
  });
});

describe("buildVersionRequest", () => {
  const model = {
    provider: "openai" as const,
    model: "gpt-image-2",
    aspect: "4:5",
    guidance: 7.5,
    strength: 0.65,
  };

  it("re-frames the approved scene at the version's aspect, never cropping the product", () => {
    const request = buildVersionRequest({
      product: CUTTING_BOARD,
      sourceOutput: "https://storage.test/cards/hook.png",
      aspect: "9:16",
      text: true,
      model,
    });
    expect(request.masterAssetUrl).toBe("https://storage.test/cards/hook.png");
    expect(request.model).toMatchObject({
      model: "gpt-image-2",
      aspect: "9:16",
    });
    expect(request.imageInputs).toEqual([]);
    expect(request.prompt).toContain("taller 9:16 frame");
    expect(request.prompt).toContain("Never crop into the product");
    expect(request.prompt).toContain("upper third");
    expect(request.negative).toContain("cropped product");
  });

  it("asks for headline space only when the slot has a text layer", () => {
    const square = buildVersionRequest({
      product: CUTTING_BOARD,
      sourceOutput: "https://storage.test/cards/in-use.png",
      aspect: "1:1",
      text: false,
      model,
    });
    expect(square.prompt).toContain("square 1:1 frame");
    expect(square.prompt).not.toContain("headline");
  });
});

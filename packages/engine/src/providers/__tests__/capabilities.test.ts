import { describe, expect, it } from "vitest";
import { canUse } from "@/providers/capabilities";
import { CapabilityError } from "@/providers/errors";
import { getImageProvider } from "@/providers/registry";
import type { ImageComposeInput, ImageEditInput } from "@/providers/types";

const google = getImageProvider("google");
const openai = getImageProvider("openai");

const composeInput: ImageComposeInput = {
  prompt: "compose",
  imageInputs: ["a", "b"],
  negative: "",
  model: {
    provider: "openai",
    model: "x",
    aspect: "4:5",
    guidance: 7.5,
    strength: 0.65,
  },
};

describe("capability flags", () => {
  it("google supports compose, openai does not", () => {
    expect(google.capabilities.compose).toBe(true);
    expect(openai.capabilities.compose).toBe(false);
  });

  it("maxRefs differs: google 3, openai 1", () => {
    expect(google.capabilities.maxRefs).toBe(3);
    expect(openai.capabilities.maxRefs).toBe(1);
  });
});

describe("compose gating", () => {
  it("openai.compose throws CapabilityError (unsupported)", async () => {
    await expect(openai.compose(composeInput)).rejects.toBeInstanceOf(
      CapabilityError,
    );
    await expect(openai.compose(composeInput)).rejects.toMatchObject({
      provider: "openai",
      op: "compose",
      reason: "unsupported",
    });
  });

  it("google.compose succeeds and returns one asset", async () => {
    const result = await google.compose({
      ...composeInput,
      model: { ...composeInput.model, provider: "google" },
    });
    expect(result.provider).toBe("google");
    expect(result.assets).toHaveLength(1);
  });
});

describe("maxRefs gating", () => {
  it("openai.edit rejects 2 refs (max 1)", async () => {
    const input: ImageEditInput = {
      masterAssetUrl: "u",
      prompt: "p",
      imageInputs: ["r1", "r2"],
      negative: "",
      model: {
        provider: "openai",
        model: "x",
        aspect: "4:5",
        guidance: 7.5,
        strength: 0.65,
      },
    };
    await expect(openai.edit(input)).rejects.toMatchObject({
      reason: "max-refs-exceeded",
    });
  });

  it("google.edit accepts 3 refs; canUse rejects 4", async () => {
    const input: ImageEditInput = {
      masterAssetUrl: "u",
      prompt: "p",
      imageInputs: ["r1", "r2", "r3"],
      negative: "",
      model: {
        provider: "google",
        model: "x",
        aspect: "4:5",
        guidance: 7.5,
        strength: 0.65,
      },
    };
    await expect(google.edit(input)).resolves.toBeDefined();
    expect(canUse(google, "edit", 4)).toBe(false);
    expect(canUse(openai, "compose", 1)).toBe(false);
  });
});

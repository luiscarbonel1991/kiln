import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_BRAND, SEED_RECIPE } from "@/domain/seed";
import { MOCK_UNDERSTANDING } from "@/providers/mock/vision";

const input = {
  understanding: MOCK_UNDERSTANDING,
  recipe: SEED_RECIPE,
  brand: SEED_BRAND,
  n: 5,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("art director without a key", () => {
  it("a mock run returns the recipe's own directions, one per slot", async () => {
    vi.stubEnv("KILN_PROVIDERS", "mock");
    const { googleArtDirector } = await import(
      "@/providers/google/art-director"
    );
    const { value } = await googleArtDirector.proposeDirections(input, {
      model: "gemini-3.5-flash",
    });
    expect(value.map((v) => v.direction)).toEqual(
      SEED_RECIPE.directions.map((d) => d.label),
    );
    for (const v of value) {
      expect(v.scene).toBeTruthy();
      expect(v.composition).toBeTruthy();
      expect(v.lighting).toBeTruthy();
    }
  });

  it("a live run refuses before any call: it never invents an answer", async () => {
    const { googleArtDirector } = await import(
      "@/providers/google/art-director"
    );
    const { openaiArtDirector } = await import(
      "@/providers/openai/art-director"
    );
    await expect(
      googleArtDirector.proposeDirections(input, { model: "gemini-3.5-flash" }),
    ).rejects.toMatchObject({ name: "ProviderKeyMissing" });
    await expect(
      openaiArtDirector.proposeDirections(input, { model: "gpt-6.1-sol" }),
    ).rejects.toMatchObject({ name: "ProviderKeyMissing" });
  });

  it("refuses a text model Kiln does not offer", async () => {
    const { openaiArtDirector } = await import(
      "@/providers/openai/art-director"
    );
    await expect(
      openaiArtDirector.proposeDirections(input, { model: "gpt-image-2" }),
    ).rejects.toMatchObject({ name: "ModelRefused" });
  });
});

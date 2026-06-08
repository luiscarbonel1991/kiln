import { describe, expect, it } from "vitest";
import {
  assemblePrompt,
  buildPlanningContext,
  type CardFieldsLike,
  FIELD_KEYS,
  resolveField,
} from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import { SEED_BRAND, SEED_RECIPE, SEED_RECIPE_LASER } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";

const understanding: BaseUnderstanding = {
  subject: "glazed stoneware pitcher, matte cream finish",
  materials: "stoneware, reactive glaze",
  lighting: "soft directional light, upper-left",
  composition: "centered, slight high angle",
  mood: "calm, handmade, editorial",
  palette: ["#c0461f", "#e8a13a"],
};

const master: MasterAsset = {
  id: "m-test",
  origin: "upload",
  sourcePrompt: null,
  assetUrl: "https://stub.local/master.png",
  mime: "image/png",
};

describe("FIELD_KEYS", () => {
  it("is the five card field keys in prompt order", () => {
    expect(FIELD_KEYS).toEqual([
      "subject",
      "materials",
      "scene",
      "composition",
      "lighting",
      "mood",
      "palette",
    ]);
  });
});

describe("resolveField precedence (no local layer)", () => {
  it("subject resolves from the image layer", () => {
    expect(
      resolveField(
        "subject",
        undefined,
        understanding,
        SEED_RECIPE,
        SEED_BRAND,
      ),
    ).toEqual({ value: understanding.subject, source: "image", locked: true });
  });

  it("scene resolves from the recipe layer", () => {
    expect(
      resolveField("scene", undefined, understanding, SEED_RECIPE, SEED_BRAND),
    ).toEqual({ value: "soft neutral sweep", source: "recipe", locked: false });
  });

  it("composition resolves from the recipe layer (recipe overrides image)", () => {
    expect(
      resolveField(
        "composition",
        undefined,
        understanding,
        SEED_RECIPE,
        SEED_BRAND,
      ),
    ).toEqual({ value: "centered top-down", source: "recipe", locked: false });
  });

  it("lighting resolves from the image layer", () => {
    expect(
      resolveField(
        "lighting",
        undefined,
        understanding,
        SEED_RECIPE,
        SEED_BRAND,
      ),
    ).toEqual({ value: understanding.lighting, source: "image", locked: true });
  });

  it("palette resolves from the image layer (extracted colors win over brand)", () => {
    expect(
      resolveField(
        "palette",
        undefined,
        understanding,
        SEED_RECIPE,
        SEED_BRAND,
      ),
    ).toEqual({
      value: understanding.palette.join(", "),
      source: "image",
      locked: true,
    });
  });

  it("palette falls back to brand when the image extracted no palette", () => {
    expect(
      resolveField(
        "palette",
        undefined,
        { ...understanding, palette: [] },
        SEED_RECIPE,
        SEED_BRAND,
      ),
    ).toEqual({
      value: SEED_BRAND.palette.join(", "),
      source: "brand",
      locked: true,
    });
  });
});

describe("resolveField local override", () => {
  it("a local field wins over every other layer", () => {
    const current: CardFieldsLike = {
      fields: {
        palette: { value: "just terracotta", source: "local", locked: false },
      },
    };
    expect(
      resolveField("palette", current, understanding, SEED_RECIPE, SEED_BRAND),
    ).toEqual({ value: "just terracotta", source: "local", locked: false });
  });

  it("falls through to the owning layer for keys without a local edit", () => {
    const current: CardFieldsLike = {
      fields: {
        subject: { value: "edited", source: "local", locked: false },
      },
    };
    expect(
      resolveField("scene", current, understanding, SEED_RECIPE, SEED_BRAND)
        .source,
    ).toBe("recipe");
  });
});

describe("buildPlanningContext", () => {
  it("produces the five fields with the right sources", () => {
    const fields = buildPlanningContext(understanding, SEED_RECIPE, SEED_BRAND);
    expect(fields.subject.source).toBe("image");
    expect(fields.materials.source).toBe("image");
    expect(fields.scene.source).toBe("recipe");
    expect(fields.composition.source).toBe("recipe");
    expect(fields.lighting.source).toBe("image");
    expect(fields.mood.source).toBe("image");
    expect(fields.palette.source).toBe("image");
  });
});

describe("assemblePrompt", () => {
  it("formats the prompt in subject, composition, scene, lighting — palette order", () => {
    const { prompt } = assemblePrompt(
      undefined,
      master,
      understanding,
      SEED_RECIPE,
      SEED_BRAND,
    );
    expect(prompt).toContain(understanding.subject);
    expect(prompt).toContain(understanding.materials);
    expect(prompt).toContain("soft neutral sweep");
    expect(prompt).toContain("centered top-down");
    expect(prompt).toContain(understanding.lighting);
    expect(prompt).toContain(understanding.mood);
    expect(prompt).toContain(understanding.palette.join(", "));
  });

  it("leads with the card direction so each variant differs", () => {
    const { prompt } = assemblePrompt(
      undefined,
      master,
      understanding,
      SEED_RECIPE,
      SEED_BRAND,
      "Lifestyle",
    );
    expect(prompt).toContain('"Lifestyle"');
    expect(prompt).toContain(understanding.subject);
    expect(prompt).toContain(understanding.materials);
  });

  it("uses a built card's stored variant scene/composition over the recipe defaults", () => {
    // The ArtDirector's per-slot values are stored on the card with source
    // "recipe" (not "local"). At generate time they MUST win over the recipe's
    // generic fieldDefaults — otherwise every card renders the same plain sweep.
    const current: CardFieldsLike = {
      fields: {
        scene: {
          value: "mounted on a raw oak apartment door, brass lever handle",
          source: "recipe",
          locked: false,
        },
        composition: {
          value: "medium close-up, angled from the side",
          source: "recipe",
          locked: false,
        },
      },
    };
    const { prompt } = assemblePrompt(
      current,
      master,
      understanding,
      SEED_RECIPE,
      SEED_BRAND,
      "In-use mockup",
    );
    expect(prompt).toContain("mounted on a raw oak apartment door");
    expect(prompt).toContain("medium close-up, angled from the side");
    expect(prompt).not.toContain("soft neutral sweep");
    expect(prompt).not.toContain("centered top-down");
  });

  it("always lists master.assetUrl first, then references", () => {
    const current: CardFieldsLike = {
      references: ["https://stub.local/ref.png"],
    };
    const { imageInputs } = assemblePrompt(
      current,
      master,
      understanding,
      SEED_RECIPE,
      SEED_BRAND,
    );
    expect(imageInputs).toEqual([
      master.assetUrl,
      "https://stub.local/ref.png",
    ]);
  });

  it("includes only the master when there are no references", () => {
    const { imageInputs } = assemblePrompt(
      undefined,
      master,
      understanding,
      SEED_RECIPE,
      SEED_BRAND,
    );
    expect(imageInputs).toEqual([master.assetUrl]);
  });

  it("derives the negative from the recipe constraints", () => {
    const { negative } = assemblePrompt(
      undefined,
      master,
      understanding,
      SEED_RECIPE,
      SEED_BRAND,
    );
    expect(negative).toBe("text overlay, watermark");
  });

  it("uses a line-art prompt (not photographic) for a line-art recipe", () => {
    const { prompt } = assemblePrompt(
      undefined,
      master,
      understanding,
      SEED_RECIPE_LASER,
      SEED_BRAND,
      "Cut outline",
    );
    expect(prompt).toMatch(/line art/i);
    expect(prompt).toMatch(/black/i);
    expect(prompt).not.toMatch(/photorealistic/i);
    expect(prompt).not.toContain("product photograph");
    // The slot's purpose becomes the per-slot treatment.
    expect(prompt).toContain("single continuous outline");
  });
});

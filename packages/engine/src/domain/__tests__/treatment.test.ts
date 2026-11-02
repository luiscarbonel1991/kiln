import { describe, expect, it } from "vitest";
import { assemblePrompt } from "@/domain/cascade";
import { reliefLabel } from "@/domain/product";
import { productUnderstanding } from "@/domain/product-understanding";
import { sceneCues } from "@/domain/scene-direction";
import { SEED_BRAND, SEED_RECIPE } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

// Two plates that look alike from the front: one with raised lettering, one
// engraved flush. The treatment decides how each is drawn, never the model.
const plate = {
  ...CUTTING_BOARD,
  material: "matte panel",
  dimensions: { w: 5, h: 3, relief: 0.125, unit: "in" as const },
  colours: [
    {
      key: "black",
      name: "Black Matte",
      face: "#1A1A1A",
      inlay: "#FFFFFF",
      inStock: true,
    },
  ],
  defaultColour: "black",
};
const raised = { ...plate, treatment: "raised" as const };
const engraved = {
  ...plate,
  treatment: "engraved" as const,
  dimensions: { w: 5, h: 3, unit: "in" as const },
};

const master = {
  id: "m",
  origin: "product" as const,
  sourcePrompt: null,
  assetUrl: "https://stub.local/plate.png",
  mime: "image/png",
};

describe("reliefLabel", () => {
  it("says a relief the way a maker does", () => {
    expect(reliefLabel(0.125, "in")).toBe("1/8 in");
    expect(reliefLabel(0.25, "in")).toBe("1/4 in");
    expect(reliefLabel(1.5, "in")).toBe("1 1/2 in");
    expect(reliefLabel(0.3, "in")).toBe("0.3 in");
    expect(reliefLabel(3, "mm")).toBe("3 mm");
  });
});

describe("the treatment drives the prompt", () => {
  it("raised lettering stands proud, with side walls and shadows, never flat", () => {
    const u = productUnderstanding(raised);
    expect(u.materials).toContain(
      "white raised elements standing 1/8 in proud of the face, their side walls visible, a short soft shadow under each",
    );
    expect(u.avoid).toBe(
      "flat printed lettering, lettering flush with the face, mirrored or reflected lettering",
    );
  });

  it("engraved lettering is flush, never raised", () => {
    const u = productUnderstanding(engraved);
    expect(u.materials).toContain(
      "white engraved detail cut into the face and flush with it, a slightly textured engraved surface, no relief above the face",
    );
    expect(u.avoid).toBe(
      "raised lettering, shadows under the lettering, mirrored or reflected lettering",
    );
  });

  it("a layered build shows its base through every cut, never paint", () => {
    const layered = { ...plate, treatment: "reveal" as const };
    const u = productUnderstanding(layered);
    expect(u.materials).toContain(
      "a two-layer build: the design cut cleanly through the top layer (1/8 in thick), so every mark shows the white base layer beneath, the marks recessed below the face with crisp vertical cut walls, nothing painted or printed",
    );
    expect(u.avoid).toBe(
      "painted lettering, printed lettering, raised lettering, mirrored or reflected lettering",
    );
    expect(u.palette).toEqual(["#1A1A1A", "#FFFFFF"]);
    // A package without the base's colour still says it contrasts.
    const unknown = productUnderstanding({
      ...layered,
      colours: [{ ...plate.colours[0], inlay: undefined }],
    });
    expect(unknown.materials).toContain("shows the contrasting base layer");
  });

  it("loose letters are separate pieces on the surface, never on a panel", () => {
    const letters = {
      ...plate,
      name: "Door numbers",
      shape: "door numbers",
      treatment: "letters" as const,
      dimensions: { w: 15, h: 6, d: 0.125, unit: "in" as const },
      colours: [{ ...plate.colours[0], inlay: undefined }],
    };
    const u = productUnderstanding(letters);
    expect(u.subject).toContain(
      "Door numbers: door numbers in black matte panel, 15 x 6 in overall, each letter and digit its own separate piece with no backing plate, panel or board behind or between them",
    );
    expect(u.materials).toContain(
      "each letter and digit cut out on its own with crisp edges, 1/8 in thick, fixed flat on the surface it is mounted on, a short soft shadow behind each piece",
    );
    expect(u.avoid).toBe(
      "a backing plate, a panel or board behind the letters, letters joined into one piece, lettering printed or painted on the surface, mirrored or reflected lettering",
    );
    // On standoffs, the relief is how far they float.
    const floating = productUnderstanding({
      ...letters,
      dimensions: { ...letters.dimensions, relief: 0.5 },
    });
    expect(floating.materials).toContain(
      "standing 1/2 in off the surface it is mounted on",
    );
    expect(sceneCues(letters, "an apartment door")).toContain(
      "each letter and digit a separate piece fixed straight on the surface, nothing behind or between them",
    );
    expect(sceneCues(plate, "an apartment door").join(" ")).not.toContain(
      "separate piece",
    );
  });

  it("the negative prompt carries what the treatment must never look like", () => {
    const { negative } = assemblePrompt(
      undefined,
      master,
      productUnderstanding(raised),
      SEED_RECIPE,
      SEED_BRAND,
    );
    expect(negative).toContain("flat printed lettering");
    // An older snapshot without `avoid` adds nothing.
    const older = assemblePrompt(
      undefined,
      master,
      { ...productUnderstanding(raised), avoid: "" },
      SEED_RECIPE,
      SEED_BRAND,
    );
    expect(older.negative).not.toContain("lettering");
  });
});

describe("mirrored lettering", () => {
  it("a product with wording never shows it mirrored, and its scenes keep glossy surfaces away", () => {
    expect(productUnderstanding(engraved).avoid).toContain(
      "mirrored or reflected lettering",
    );
    const blank = { ...engraved, wording: [] };
    expect(productUnderstanding(blank).avoid).not.toContain("mirrored");
    expect(sceneCues(engraved, "a kitchen counter")).toContain(
      "the surfaces around it matte or honed, nothing glossy that mirrors its lettering",
    );
    expect(sceneCues(blank, "a kitchen counter").join(" ")).not.toContain(
      "mirrors",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  GENERIC_SURFACE,
  GENERIC_USE,
  inSentence,
  sceneCues,
  sceneVariants,
  surfaceCue,
} from "@/domain/scene-direction";
import type { BaseUnderstanding } from "@/domain/understanding";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const understanding: BaseUnderstanding = {
  subject: "a coaster",
  productType: "coaster",
  useContext: "",
  sceneProps: "",
  avoid: "",
  materials: "cork",
  lighting: "soft natural light",
  composition: "the product centered",
  mood: "calm",
  palette: ["#D9B98C"],
};

const slots = [
  { label: "Hero", purpose: "Win the click.", scene: "a clean sweep" },
  { label: "In use", purpose: "Show it used.", scene: "in use at {use}" },
  { label: "Lifestyle", purpose: "Sell it.", scene: "a styled {use}" },
  { label: "Gift", purpose: "Show it gift-ready to trigger Etsy gift-buying." },
];

describe("sceneVariants", () => {
  it("a slot's own scene wins; {use} takes the places of use in order", () => {
    const v = sceneVariants(slots, {}, understanding, [
      "a coffee table",
      "a reading nook",
    ]);
    expect(v.map((x) => x.scene).slice(0, 3)).toEqual([
      "a clean sweep",
      "in use at a coffee table",
      "a styled a reading nook",
    ]);
    expect(v.map((x) => x.direction)).toEqual([
      "Hero",
      "In use",
      "Lifestyle",
      "Gift",
    ]);
  });

  it("wraps around the places of use, and names a generic place without any", () => {
    const one = sceneVariants(slots, {}, understanding, ["a desk"]);
    expect(one[1].scene).toBe("in use at a desk");
    expect(one[2].scene).toBe("a styled a desk");
    const none = sceneVariants(slots, {}, understanding, []);
    expect(none[1].scene).toBe(`in use at ${GENERIC_USE}`);
  });

  it("a slot without a scene leans the defaults to its purpose, mid-sentence and without a double period", () => {
    const [, , , gift] = sceneVariants(
      slots,
      { scene: "soft neutral sweep", composition: "centered" },
      understanding,
      [],
    );
    expect(gift.scene).toBe(
      "soft neutral sweep — show it gift-ready to trigger Etsy gift-buying",
    );
    expect(gift.composition).toBe("centered");
    expect(gift.lighting).toBe("soft natural light");
  });

  it("composition and lighting: the slot's, else the defaults, else the understanding", () => {
    const [v] = sceneVariants(
      [
        {
          label: "Detail",
          purpose: "p",
          composition: "macro",
          lighting: "raking",
        },
      ],
      {},
      understanding,
      [],
    );
    expect([v.composition, v.lighting]).toEqual(["macro", "raking"]);
  });
});

describe("inSentence", () => {
  it("lowers only the first letter and drops the final period", () => {
    expect(inSentence("Show it on Etsy.")).toBe("show it on Etsy");
  });
});

describe("sceneCues", () => {
  it("compares the product with the nearest everyday object and picks the background by its face", () => {
    const small = {
      ...CUTTING_BOARD,
      dimensions: { w: 5, h: 3, unit: "in" as const },
      colours: [{ key: "k", name: "Black", face: "#1A1A1A", inStock: true }],
      defaultColour: "k",
    };
    const [size, legible, contrast] = sceneCues(small);
    expect(size).toBe(
      "the product true to its real size (5 x 3 in, about the size of a phone) against every object around it",
    );
    expect(legible).toContain("text and design to read clearly");
    expect(contrast).toBe(
      "its dark face set against a lighter background, so it stands out",
    );
  });

  it("only scenes set in a place of use carry them", () => {
    const [studio, inPlace] = sceneVariants(
      [
        { label: "Hero", purpose: "hero", scene: "a seamless sweep" },
        { label: "In use", purpose: "in use", scene: "in use at {use}" },
      ],
      { composition: "centered" },
      understanding,
      ["a kitchen counter"],
      { inPlace: () => ["cue one", "cue two"], surface: "x" },
    );
    expect(studio.composition).toBe("centered");
    expect(inPlace.composition).toBe("centered; cue one; cue two");
  });
});

describe("{surface}", () => {
  const macro = {
    label: "Detail",
    purpose: "detail",
    scene: "a macro close-up",
    composition: "a tight crop, {surface}, shallow depth of field",
  };

  it("a raised product is seen at a low raking angle, an engraved one flush", () => {
    expect(surfaceCue({ ...CUTTING_BOARD, treatment: "raised" })).toContain(
      "low raking angle across the face so the raised elements' side walls and short shadows show",
    );
    expect(surfaceCue(CUTTING_BOARD)).toContain(
      "the engraving flush with the face",
    );
    const [detail] = sceneVariants([macro], {}, understanding, [], {
      inPlace: () => [],
      surface: surfaceCue({ ...CUTTING_BOARD, treatment: "raised" }),
    });
    expect(detail.composition).toContain("a tight crop, seen at a low raking");
  });

  it("without a product the macro still reads", () => {
    const [detail] = sceneVariants([macro], {}, understanding, []);
    expect(detail.composition).toBe(
      `a tight crop, ${GENERIC_SURFACE}, shallow depth of field`,
    );
  });
});

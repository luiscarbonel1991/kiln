import { describe, expect, it } from "vitest";
import {
  GENERIC_SURFACE,
  GENERIC_USE,
  inSentence,
  placeObjects,
  productSceneCues,
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

describe("a slot's knobs", () => {
  const tuned = {
    label: "In use",
    purpose: "Show it used.",
    scene: "in use at {use}",
    composition: "the product the hero",
    lighting: "natural window light",
  };

  it("put the camera before the composition and the distance after it", () => {
    const [v] = sceneVariants(
      [{ ...tuned, knobs: { camera: "above", distance: "medium" } }],
      {},
      understanding,
      ["a desk"],
    );
    expect(v.composition).toBe(
      "the camera a little above, looking down at about 30 degrees, so the top of anything lying flat shows, the product the hero, a medium shot, its surroundings readable",
    );
  });

  it("light takes the slot's lighting's place; the shadow follows", () => {
    const [v] = sceneVariants(
      [{ ...tuned, knobs: { light: "studio", shadow: "strong" } }],
      {},
      understanding,
      [],
    );
    expect(v.lighting).toBe(
      "soft, even studio light, crisp, defined shadows, as in direct sun",
    );
  });

  it("'any' light keeps the slot's, else the understanding's, before the shadow", () => {
    const [own, none] = sceneVariants(
      [
        { ...tuned, knobs: { light: "any", shadow: "soft" } },
        {
          label: "Hero",
          purpose: "Win the click.",
          knobs: { light: "any", shadow: "soft" },
        },
      ],
      {},
      understanding,
      [],
    );
    expect(own.lighting).toBe("natural window light, a soft contact shadow");
    expect(none.lighting).toBe("soft natural light, a soft contact shadow");
  });

  it("props follow the scene, after its place", () => {
    const [v] = sceneVariants(
      [{ ...tuned, knobs: { props: "none" } }],
      {},
      understanding,
      ["a desk"],
    );
    expect(v.scene).toBe("in use at a desk, no props beyond the place itself");
  });

  it("a wide shot keeps the product true to size without asking to frame closer", () => {
    const cues = productSceneCues(CUTTING_BOARD);
    const [wide, medium] = sceneVariants(
      [
        { ...tuned, knobs: { distance: "wide" } },
        { ...tuned, knobs: { distance: "medium" } },
      ],
      {},
      understanding,
      ["a kitchen counter"],
      cues,
    );
    expect(wide.composition).toContain(
      "never enlarged beyond its real size, even in a wider shot, its design still recognizable",
    );
    expect(wide.composition).not.toContain("frame closer");
    expect(medium.composition).toContain("frame closer to it instead");
  });

  it("'any' everywhere reads as a slot without knobs", () => {
    const any = {
      camera: "any",
      distance: "any",
      light: "any",
      shadow: "any",
      props: "any",
    } as const;
    expect(
      sceneVariants([{ ...tuned, knobs: any }], {}, understanding, ["a desk"]),
    ).toEqual(sceneVariants([tuned], {}, understanding, ["a desk"]));
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
    const [size, legible, contrast, plain] = sceneCues(small);
    expect(plain).toBe("everything around it plain and unbranded");
    expect(size).toBe(
      "the product true to its real size (5 x 3 in, about the size of a phone) against every object around it",
    );
    expect(legible).toBe(
      "never enlarged beyond its real size: frame closer to it instead, so its text and design still read",
    );
    expect(contrast).toBe(
      "its dark face set against a lighter background, so it stands out",
    );
  });

  it("sizes the product against the objects its place names", () => {
    const plaque = {
      ...CUTTING_BOARD,
      dimensions: { w: 5, h: 3, unit: "in" as const },
    };
    // The longest name wins ("video doorbell", not "door" + "doorbell"),
    // and both objects of a place are used, in order.
    expect(
      sceneCues(plaque, "an exterior front door, beside a video doorbell")[0],
    ).toBe(
      "the product true to its real size: 5 x 3 in, about 1/7 as wide as the door and about twice as wide as the video doorbell",
    );
    expect(sceneCues(plaque, "the whole front door")[0]).toContain(
      "about 1/7 as wide as the door",
    );
    const coaster = {
      ...CUTTING_BOARD,
      dimensions: { w: 4, h: 4, unit: "in" as const },
    };
    expect(sceneCues(coaster, "a coffee table, under a steaming mug")[0]).toBe(
      "the product true to its real size: 4 x 4 in, about 1/10 as wide as the coffee table and about as wide as the mug",
    );
    // Millimetres are compared in inches.
    expect(
      sceneCues(
        { ...plaque, dimensions: { w: 127, h: 76, unit: "mm" as const } },
        "a door",
      )[0],
    ).toContain("about 1/7 as wide as the door");
  });

  it("a place naming no known object keeps the everyday reference", () => {
    expect(placeObjects("a sunny reading nook")).toEqual([]);
    expect(placeObjects("a doorway")).toEqual([]);
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

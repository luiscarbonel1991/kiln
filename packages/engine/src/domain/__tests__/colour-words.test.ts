import { describe, expect, it } from "vitest";
import { colourMaterial, colourWord } from "@/domain/colour-words";
import { productUnderstanding } from "@/domain/product-understanding";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

describe("colourWord", () => {
  it("names a hex with the nearest everyday colour", () => {
    expect(
      ["#FFFFFF", "#F5F5F2", "#F2E6D0", "#171311", "#3B2A1E", "#C0C0C0"].map(
        colourWord,
      ),
    ).toEqual(["white", "white", "cream", "black", "dark brown", "silver"]);
  });
});

describe("colourMaterial", () => {
  it("drops the words the colour name repeats at the start", () => {
    expect(colourMaterial("Matte Black", "matte powder-coated steel")).toBe(
      "matte black powder-coated steel",
    );
    expect(colourMaterial("Matte Black", "black matte steel")).toBe(
      "matte black steel",
    );
    expect(colourMaterial("Maple", "solid hardwood")).toBe(
      "maple solid hardwood",
    );
    expect(colourMaterial("Black Matte", "black matte")).toBe("black matte");
  });

  it("leaves the words further on, so the sentence keeps its grammar", () => {
    expect(
      colourMaterial(
        "Oak finish",
        "thin pale wood plate with an oak finish and visible straight grain",
      ),
    ).toBe(
      "oak finish thin pale wood plate with an oak finish and visible straight grain",
    );
    expect(
      colourMaterial("Black Matte", "matte panel with a zero-gloss matte face"),
    ).toBe("black matte panel with a zero-gloss matte face");
  });

  it("keeps a second part's own colour", () => {
    expect(
      colourMaterial(
        "Black Matte",
        "matte cast acrylic plate, standing in a black matte acrylic base",
      ),
    ).toBe(
      "black matte cast acrylic plate, standing in a black matte acrylic base",
    );
  });
});

describe("the marks' colour in the prompt", () => {
  const plate = {
    ...CUTTING_BOARD,
    material: "matte panel",
    treatment: "raised" as const,
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

  it("names the raised marks' colour, and says matte once", () => {
    const u = productUnderstanding(plate);
    expect(u.materials).toBe(
      "black matte panel, white raised elements standing clearly proud of the face, their side walls visible, a short soft shadow under each",
    );
    expect(u.subject).toContain("in black matte panel");
  });

  it("takes the package's own name for the colour when it gives one", () => {
    const u = productUnderstanding({
      ...plate,
      colours: [{ ...plate.colours[0], inlayName: "Ivory" }],
    });
    expect(u.materials).toContain("ivory raised elements");
  });

  it("an engraved board says what colour its engraving reads", () => {
    expect(productUnderstanding(CUTTING_BOARD).materials).toBe(
      "maple solid hardwood, dark brown engraved detail cut into the face and flush with it, a slightly textured engraved surface, no relief above the face",
    );
  });
});

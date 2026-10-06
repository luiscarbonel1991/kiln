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
  it("drops the material's words the colour name already says", () => {
    expect(colourMaterial("Matte Black", "matte powder-coated steel")).toBe(
      "matte black powder-coated steel",
    );
    expect(
      colourMaterial("Black Matte", "matte panel with a zero-gloss matte face"),
    ).toBe("black matte panel with a zero-gloss face");
    expect(colourMaterial("Maple", "solid hardwood")).toBe(
      "maple solid hardwood",
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
      "black matte panel, white raised elements on the face",
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
      "maple solid hardwood, engraved detail in dark brown",
    );
  });
});

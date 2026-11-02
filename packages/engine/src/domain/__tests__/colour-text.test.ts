import { describe, expect, it } from "vitest";
import { DOOR_TAG } from "@/domain/__tests__/fixtures/door-tag";
import { colourTextConflict, colourTextWarning } from "@/domain/colour-text";
import { colourWordsIn } from "@/domain/colour-words";
import { Product } from "@/domain/product";

// The door tag with text written for its black/white default, as a maker
// writes it: the name and material say the colours, and the gold finish is
// forbidden.
const NAMED = Product.parse({
  ...DOOR_TAG,
  name: "Engraved door tag, black & white",
  material:
    "two-tone laminate, a satin BLACK face; the marks are engraved through it and read WHITE",
  forbidden: ["other text", "gold or metallic finish", "wood"],
});

describe("colourWordsIn", () => {
  it("reads the everyday colour words a text names", () => {
    expect([...colourWordsIn("Two-tone Black/White")]).toEqual([
      "black",
      "white",
    ]);
    expect([...colourWordsIn("Brushed GOLD, a gray core")]).toEqual([
      "gold",
      "grey",
    ]);
    expect(colourWordsIn("Matte Terra Cotta").size).toBe(0);
  });
});

describe("colourTextConflict", () => {
  it("finds the name and material saying the default's colours, and the list forbidding this one", () => {
    expect(colourTextConflict(NAMED, "gold-black")).toEqual({
      says: ["white"],
      fields: ["name", "material"],
      forbids: ["gold or metallic finish"],
    });
  });

  it("never flags the default colour, or text that names no colour", () => {
    expect(colourTextConflict(NAMED, "black-white")).toBeNull();
    expect(colourTextConflict(DOOR_TAG, "gold-black")).toBeNull();
  });

  it("checks only what the colour does not say for itself", () => {
    const own = Product.parse({
      ...NAMED,
      colours: NAMED.colours.map((c) =>
        c.key === "gold-black"
          ? {
              ...c,
              material: "two-tone laminate, a brushed GOLD face",
              forbidden: ["other text", "black face"],
            }
          : c,
      ),
    });
    expect(colourTextConflict(own, "gold-black")).toEqual({
      says: ["white"],
      fields: ["name"],
      forbids: [],
    });
    const named = Product.parse({
      ...own,
      colours: own.colours.map((c) =>
        c.key === "gold-black"
          ? { ...c, productName: "Engraved door tag, brushed gold" }
          : c,
      ),
    });
    expect(colourTextConflict(named, "gold-black")).toBeNull();
  });
});

describe("colourTextWarning", () => {
  it("says what contradicts and what to do", () => {
    expect(colourTextWarning(NAMED, "gold-black")).toBe(
      'The product\'s text was written for Black/White: its name and material say white, and it must never show "gold or metallic finish". Give Gold/Black its own text in the product, or its scenes will say both.',
    );
    expect(colourTextWarning(DOOR_TAG, "gold-black")).toBeNull();
  });
});

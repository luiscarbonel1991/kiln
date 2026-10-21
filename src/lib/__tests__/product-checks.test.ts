import { describe, expect, it } from "vitest";
import {
  counter,
  ratioCheck,
  sizePreview,
  stillNeeded,
  wordingHint,
} from "@/lib/product-checks";

describe("product checks", () => {
  it("shows the size in both units beside an everyday object", () => {
    expect(sizePreview(2.3, 1.25, "in")).toBe(
      "2.3 x 1.25 in (58 x 32 mm) · smaller than a credit card",
    );
    expect(sizePreview(85, 54, "mm")).toBe(
      "85 x 54 mm (3.35 x 2.13 in) · about the size of a credit card",
    );
    expect(sizePreview(0, 1, "in")).toBeNull();
  });

  it("says when a design's proportions do not match the size", () => {
    expect(ratioCheck(2, 2.3, 1.25)).toBe(
      "Your design is 2.00:1; 2.3 x 1.25 is 1.84:1.",
    );
    expect(ratioCheck(2, 2.5, 1.25)).toBeNull();
    expect(ratioCheck(null, 2.3, 1.25)).toBeNull();
  });

  it("counts a field once it nears its limit", () => {
    expect(counter("short", 60)).toBeNull();
    expect(counter("x".repeat(50), 60)).toBe("50/60");
  });

  it("hints at what a personalization line is missing", () => {
    expect(wordingHint({ label: "Sofia", example: "", maxChars: "" })).toEqual({
      words: "Without an example, How to personalize shows an empty box.",
      swap: "Sofia",
    });
    expect(
      wordingHint({ label: "", example: "Sofia", maxChars: "" })?.words,
    ).toBe("Say what the buyer writes, like “Name”.");
    expect(
      wordingHint({ label: "Name", example: "Alexandria", maxChars: "6" })
        ?.words,
    ).toBe("The example has 10 characters; the line takes 6.");
    expect(
      wordingHint({ label: "Name", example: "Sofia", maxChars: "" }),
    ).toBeNull();
  });

  it("lists what the form still needs, in words", () => {
    expect(
      stillNeeded({
        name: "",
        whatItIs: "tag",
        width: 0,
        height: 1,
        unit: "in",
        material: "",
        treatment: "engraved",
        colours: [{ name: "", hex: "#D9B98C" }],
        wording: [],
        views: [],
      }),
    ).toEqual(["a name", "its size", "its material", "a colour's name"]);
  });
});

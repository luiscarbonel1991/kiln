import { describe, expect, it } from "vitest";
import { aspectFor } from "@/providers/google/image";

// Gemini's image model accepts a fixed aspectRatio set; our listing slots use
// values (4:5, 5:4) outside it, so aspectFor snaps them to the nearest supported
// frame. This is the lever that makes the hero render square and the in-use
// portrait (Gemini ignores `strength` but honors aspectRatio).
describe("aspectFor", () => {
  it("passes through Gemini-supported aspects unchanged", () => {
    for (const a of [
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "9:16",
      "16:9",
      "21:9",
    ]) {
      expect(aspectFor(a)).toBe(a);
    }
  });

  it("snaps unsupported slot aspects to the nearest supported frame", () => {
    expect(aspectFor("4:5")).toBe("3:4");
    expect(aspectFor("5:4")).toBe("4:3");
  });

  it("falls back to square for unknown values", () => {
    expect(aspectFor("")).toBe("1:1");
    expect(aspectFor("banana")).toBe("1:1");
  });
});

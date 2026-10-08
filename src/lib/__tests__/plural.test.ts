import { describe, expect, it } from "vitest";
import { plural } from "@/lib/plural";

describe("plural", () => {
  it("is singular for one only", () => {
    expect(plural(1, "scene")).toBe("1 scene");
    expect(plural(0, "scene")).toBe("0 scenes");
    expect(plural(3, "frame")).toBe("3 frames");
    expect(plural(2, "box", "boxes")).toBe("2 boxes");
  });
});

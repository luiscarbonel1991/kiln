import { describe, expect, it } from "vitest";
import { onIndexes, slotPosition } from "@/components/projects/slot-frame";

describe("photo numbers", () => {
  const etsy = { name: "Etsy", kind: "sale" as const };

  it("count only the slots switched on", () => {
    const places = onIndexes([false, true, false, false]);
    expect(places).toEqual([0, null, 1, 2]);
    expect(places.map((p) => slotPosition(etsy, p))).toEqual([
      "Etsy photo 1",
      "Etsy · off",
      "Etsy photo 2",
      "Etsy photo 3",
    ]);
    expect(slotPosition({ name: "Instagram", kind: "content" }, 0)).toBe(
      "Slide 1",
    );
  });
});

import { describe, expect, it } from "vitest";
import { planChangeLines } from "@/lib/plan-changes";

describe("planChangeLines", () => {
  it("says what an update adds and removes, per destination", () => {
    expect(
      planChangeLines(
        [
          {
            destinationId: "etsy",
            key: "colours",
            label: "Colour options",
            change: "adds",
          },
          {
            destinationId: "etsy",
            key: "personalize",
            label: "How to personalize",
            change: "removes",
          },
        ],
        ["etsy"],
      ),
    ).toEqual([
      "Etsy: adds Colour options; removes How to personalize.",
      "Etsy was delivered: its photos renumber, so deliver it again.",
    ]);
  });

  it("says nothing when the plan stays", () => {
    expect(planChangeLines([], [])).toEqual([]);
  });
});

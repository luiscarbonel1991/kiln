import { describe, expect, it } from "vitest";
import { draftApprovalLines, priceLabel, wordsOf } from "@/lib/drafts-view";

describe("the drafts pages' words", () => {
  it("says a price in the shop's currency", () => {
    expect(priceLabel(48, "USD")).toBe("$48.00");
    expect(priceLabel(48, undefined)).toBe("48.00");
  });

  it("reads a list typed between commas", () => {
    expect(wordsOf(" oak, kitchen gift ,, ")).toEqual(["oak", "kitchen gift"]);
  });

  it("shows the maker what a draft write would send before they allow it", () => {
    expect(
      draftApprovalLines("edit_draft", {
        listing: 1501,
        title: "Oak board",
        tags: ["oak", "gift"],
        price: 52,
      }),
    ).toEqual([
      "Draft 1501 in your Etsy shop:",
      "Title → Oak board",
      "Tags → oak, gift",
      "Price → 52",
    ]);
    expect(draftApprovalLines("make_draft", { project: "p1" })).toEqual([
      "A new draft in your Etsy shop from project p1: its listing text, approved photos and price.",
      "It stays a draft: you publish it in Etsy.",
    ]);
    expect(draftApprovalLines("generate", {})).toEqual([]);
  });
});

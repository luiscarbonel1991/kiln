import { describe, expect, it } from "vitest";
import { TEXT_CALL_BUDGETS, textEstimate } from "@/domain/generation-cost";
import { mockProductReview } from "@/providers/mock/art-director";
import {
  ProductReview,
  productReviewPrompt,
  type ReviewField,
} from "@/providers/text-prompts";

// Luis's keychain as he first typed it: "Sofia" in the label, no example.
const FIELDS: ReviewField[] = [
  { field: "name", value: "Engraved name keychain", maxChars: 80 },
  { field: "whatItIs", value: "keychain", maxChars: 60 },
  {
    field: "size",
    value: "2.3 x 1.25 in (58 x 32 mm) · smaller than a credit card",
    checkOnly: true,
  },
  { field: "material", value: "birch", maxChars: 60 },
  {
    field: "treatment",
    value: "engraved",
    options: ["engraved", "raised", "inlaid", "printed", "cut"],
  },
  { field: "colours.0.name", value: "natural", maxChars: 40 },
  { field: "wording.0.label", value: "Sofia", maxChars: 40 },
  { field: "wording.0.example", value: "", maxChars: 60 },
  { field: "wording.0.maxChars", value: "" },
  { field: "useContexts.0", value: "", maxChars: 80 },
  { field: "hook", value: "", maxChars: 80 },
];

describe("the product review's question", () => {
  it("lists each field with what reads it, its limit and options", () => {
    const prompt = productReviewPrompt(FIELDS);
    expect(prompt).toContain('"field": "wording.0.label"');
    expect(prompt).toContain('"value": "Sofia"');
    expect(prompt).toContain("what the buyer is asked to write");
    expect(prompt).toContain("the example the frames show for that line");
    expect(prompt).toContain('"maxCharacters": 40');
    expect(prompt).toContain('"options": [');
    expect(prompt).toContain('"checkOnly": true');
    expect(prompt).toContain("Never suggest a size or a price");
    expect(prompt).toContain("At most 8 suggestions and 4 checks");
  });

  it("costs about a cent or two on the text models", () => {
    const sol = textEstimate(
      { provider: "openai", model: "gpt-6.1-sol" },
      TEXT_CALL_BUDGETS.productReview,
    );
    const flash = textEstimate(
      { provider: "google", model: "gemini-3.8-flash" },
      TEXT_CALL_BUDGETS.productReview,
    );
    expect(sol).toBeLessThanOrEqual(0.03);
    expect(flash).toBeLessThanOrEqual(0.03);
  });
});

describe("the mock review", () => {
  it("answers in the review's shape, by fixed rules", () => {
    const review = mockProductReview(FIELDS);
    expect(ProductReview.parse(review)).toEqual(review);
    expect(review.suggestions).toEqual([
      {
        field: "colours.0.name",
        value: "Natural",
        why: "Colour options and the listing show it as a name.",
      },
      {
        field: "wording.0.example",
        value: "Sofia",
        why: "How to personalize shows this example; without one its box is empty.",
      },
      {
        field: "hook",
        value: "Engraved name keychain",
        why: "A carousel opens on its hook; the name says what it is.",
      },
    ]);
    expect(review.checks).toEqual([
      {
        field: "size",
        why: "Confirm the size before you save: 2.3 x 1.25 in (58 x 32 mm) · smaller than a credit card.",
      },
    ]);
  });

  it("offers a label for an example typed without one", () => {
    const review = mockProductReview([
      { field: "wording.0.label", value: "" },
      { field: "wording.0.example", value: "Sofia" },
    ]);
    expect(review.suggestions).toEqual([
      expect.objectContaining({ field: "wording.0.label", value: "Name" }),
    ]);
    expect(review.checks).toEqual([]);
  });
});

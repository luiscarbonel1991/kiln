import { describe, expect, it } from "vitest";
import { FORM_LIMITS } from "@/lib/product-form";
import { cleanReview, reviewFields } from "@/lib/product-review";

// Luis's keychain as he first typed it.
const KEYCHAIN = {
  name: "Engraved name keychain",
  whatItIs: "keychain",
  width: 2.3,
  height: 1.25,
  unit: "in" as const,
  material: "birch",
  treatment: "engraved" as const,
  colours: [{ name: "natural" }],
  wording: [{ label: "Sofia", example: "", maxChars: 12 }],
  useContexts: ["a ring of house keys"],
};

const fields = reviewFields(KEYCHAIN, FORM_LIMITS);
const field = (name: string) => fields.find((f) => f.field === name);

describe("reviewFields", () => {
  it("reads the form field by field, with each limit", () => {
    expect(fields.map((f) => f.field)).toEqual([
      "name",
      "whatItIs",
      "size",
      "material",
      "treatment",
      "colours.0.name",
      "wording.0.label",
      "wording.0.example",
      "wording.0.maxChars",
      "useContexts.0",
      "useContexts.1",
      "hook",
      "cta",
      "description",
    ]);
    expect(field("size")).toEqual({
      field: "size",
      value: "2.3 x 1.25 in (58 x 32 mm) · smaller than a credit card",
      checkOnly: true,
    });
    expect(field("treatment")?.options).toContain("inlaid");
    // The example fits its line's maximum.
    expect(field("wording.0.example")?.maxChars).toBe(12);
    expect(field("wording.0.maxChars")?.value).toBe("12");
    // One empty place, for the review to offer.
    expect(field("useContexts.1")).toEqual({
      field: "useContexts.1",
      value: "",
      maxChars: 80,
    });
  });

  it("offers no extra place when one is empty or there are six", () => {
    const withEmpty = reviewFields(
      { ...KEYCHAIN, useContexts: ["a desk", ""] },
      FORM_LIMITS,
    );
    expect(withEmpty.filter((f) => f.field.startsWith("useContexts"))).toEqual([
      { field: "useContexts.0", value: "a desk", maxChars: 80 },
      { field: "useContexts.1", value: "", maxChars: 80 },
    ]);
    const full = reviewFields(
      {
        ...KEYCHAIN,
        useContexts: Array.from({ length: 6 }, (_, i) => `p${i}`),
      },
      FORM_LIMITS,
    );
    expect(full.some((f) => f.field === "useContexts.6")).toBe(false);
  });

  it("reads a form that would not save yet", () => {
    const partial = reviewFields(
      { name: "Keychain", width: Number.NaN, unit: "in" },
      FORM_LIMITS,
    );
    expect(partial.find((f) => f.field === "size")?.value).toBe("");
    expect(partial.find((f) => f.field === "treatment")?.value).toBe(
      "engraved",
    );
  });
});

describe("cleanReview", () => {
  const s = (f: string, value: string, why = "It reads better.") => ({
    field: f,
    value,
    why,
  });

  it("keeps a usable change per field, with its reason in one line", () => {
    const review = cleanReview(
      {
        suggestions: [
          s("wording.0.label", "Name", "The buyer is asked\n for a name."),
          s("wording.0.example", " Sofia "),
          s("colours.0.name", "Natural"),
          s("useContexts.1", "a backpack zipper"),
        ],
        checks: [{ field: "size", why: "2.3 in is unusual; is it 2.5?" }],
      },
      fields,
    );
    expect(review).toEqual({
      suggestions: [
        {
          field: "wording.0.label",
          value: "Name",
          why: "The buyer is asked for a name.",
        },
        { field: "wording.0.example", value: "Sofia", why: "It reads better." },
        { field: "colours.0.name", value: "Natural", why: "It reads better." },
        {
          field: "useContexts.1",
          value: "a backpack zipper",
          why: "It reads better.",
        },
      ],
      checks: [{ field: "size", why: "2.3 in is unusual; is it 2.5?" }],
    });
  });

  it("drops what the form cannot take", () => {
    const review = cleanReview(
      {
        suggestions: [
          s("price", "24"),
          s("size", "2.5 x 1.25 in"),
          s("width", "2.5"),
          s("name", "Engraved name keychain"),
          s("treatment", "laser-etched"),
          s("wording.0.example", "Alexandria-Rose"),
          s("wording.0.maxChars", "twelve"),
          s("wording.0.maxChars", "0"),
          s("hook", "x".repeat(81)),
          s("material", "  "),
          s("cta", "Order yours", "  "),
          s("useContexts.4", "a desk"),
        ],
        checks: [
          { field: "price", why: "Set a price." },
          { field: "size", why: "" },
        ],
      },
      fields,
    );
    expect(review).toEqual({ suggestions: [], checks: [] });
  });

  it("keeps a line's maximum that still holds its example", () => {
    const withExample = reviewFields(
      { ...KEYCHAIN, wording: [{ label: "Name", example: "Sofia" }] },
      FORM_LIMITS,
    );
    expect(
      cleanReview(
        {
          suggestions: [s("wording.0.maxChars", "4")],
          checks: [],
        },
        withExample,
      ).suggestions,
    ).toEqual([]);
    expect(
      cleanReview(
        {
          suggestions: [s("wording.0.maxChars", "12")],
          checks: [],
        },
        withExample,
      ).suggestions,
    ).toEqual([s("wording.0.maxChars", "12")]);
  });

  it("keeps at most 8 suggestions", () => {
    const ten = [
      s("name", "Name keychain"),
      s("whatItIs", "rounded keychain"),
      s("material", "birch plywood"),
      s("treatment", "raised"),
      s("colours.0.name", "Natural"),
      s("wording.0.label", "Name"),
      s("wording.0.example", "Sofia"),
      s("useContexts.1", "a backpack"),
      s("hook", "Your name, on your keys."),
      s("cta", "Order yours"),
    ];
    expect(
      cleanReview({ suggestions: ten, checks: [] }, fields).suggestions,
    ).toEqual(ten.slice(0, 8));
  });

  it("keeps the first per field, and at most 4 checks", () => {
    const many = cleanReview(
      {
        suggestions: [
          s("name", "Name keychain"),
          s("name", "Birch keychain"),
          ...Array.from({ length: 10 }, (_, i) =>
            s(i < 6 ? `useContexts.${i}` : "description", `place ${i}`),
          ),
        ],
        checks: ["name", "name", "size", "material", "whatItIs", "hook"].map(
          (f) => ({ field: f, why: `Check ${f}.` }),
        ),
      },
      reviewFields({ ...KEYCHAIN, useContexts: [] }, FORM_LIMITS),
    );
    expect(many.suggestions[0]).toEqual(s("name", "Name keychain"));
    expect(many.suggestions).toHaveLength(3);
    expect(many.checks.map((c) => c.field)).toEqual([
      "name",
      "size",
      "material",
      "whatItIs",
    ]);
  });
});

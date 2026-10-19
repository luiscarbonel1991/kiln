import { describe, expect, it } from "vitest";
import {
  checkListing,
  listingAttributes,
  listingDraft,
  listingVariations,
  refreshListing,
  withCopy,
} from "@/domain/listing";
import { SEED_DESTINATIONS } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const etsy = SEED_DESTINATIONS.find((d) => d.id === "etsy");
if (!etsy?.text) throw new Error("Etsy has no text rules");
const rules = etsy.text;

const board = {
  ...CUTTING_BOARD,
  price: 48,
  variants: [
    {
      name: "Size",
      values: [
        { key: "m", label: "12 x 8 in", priceExtra: 0 },
        { key: "l", label: "16 x 10 in", priceExtra: 12 },
      ],
    },
  ],
};

const fields = (issues: ReturnType<typeof checkListing>) =>
  issues.map(
    (i) =>
      `${i.severity} ${i.field}${i.index === undefined ? "" : `[${i.index}]`}`,
  );

describe("the channel's text rules", () => {
  it("Etsy carries its listing limits as data", () => {
    expect(rules).toMatchObject({
      title: { maxChars: 140, adviseMaxWords: 15 },
      tags: { count: 13, maxChars: 20 },
      personalization: {
        maxFields: 5,
        titleMaxChars: 45,
        instructionsMaxChars: 120,
        maxCapsWords: 1,
      },
      variations: { maxTypes: 2 },
    });
    expect(
      SEED_DESTINATIONS.find((d) => d.id === "instagram")?.text,
    ).toBeUndefined();
  });
});

describe("listingDraft", () => {
  const draft = listingDraft(board, rules);

  it("drafts every field from the spec, for free", () => {
    expect(draft.title).toEqual({
      value: "Engraved family cutting board, personalized",
      source: "spec",
    });
    expect(draft.description.value).toContain("WHAT YOU GET");
    expect(draft.description.value).toContain("16 x 10 in");
    expect(draft.description.value).toContain("Cherry (out of stock)");
    expect(draft.description.value).toContain(
      "Year: up to 4 characters (optional)",
    );
    expect(draft.materials.value).toEqual(["solid hardwood"]);
    expect(draft.personalization.value).toEqual([
      {
        title: "Family name",
        required: true,
        maxChars: 14,
        instructions:
          "Type the family name exactly as it should read, up to 14 characters.",
      },
      {
        title: "Year",
        required: false,
        maxChars: 4,
        instructions:
          "Optional. Type the year exactly as it should read, up to 4 characters.",
      },
    ]);
  });

  it("tags fit the channel: each at most 20 characters, none repeated", () => {
    const tags = draft.tags.value;
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(13);
    expect(tags.every((t) => t.length <= 20)).toBe(true);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain("kitchen");
  });

  it("the draft passes every rule the channel refuses", () => {
    expect(
      checkListing(draft, board, rules).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });

  it("is generic: nothing of a maker's catalog", () => {
    expect(JSON.stringify(draft).toLowerCase()).not.toMatch(
      /sign|acrylic|laser/,
    );
  });
});

describe("variations and attributes come from the product", () => {
  it("each value's price is the maker's price plus its extra; colours stay listed out of stock", () => {
    expect(listingVariations(board)).toEqual([
      {
        name: "Size",
        pricesVary: true,
        values: [
          { label: "12 x 8 in", price: 48, inStock: true },
          { label: "16 x 10 in", price: 60, inStock: true },
        ],
      },
      {
        name: "Colour",
        pricesVary: false,
        values: [
          { label: "Maple", inStock: true },
          { label: "Walnut", inStock: true },
          { label: "Cherry", inStock: false },
        ],
      },
    ]);
    expect(listingAttributes(board)).toEqual([
      { label: "Width", value: "16 in" },
      { label: "Height", value: "10 in" },
      { label: "Depth", value: "0.75 in" },
    ]);
  });
});

describe("checkListing", () => {
  const draft = listingDraft(board, rules);

  it("names what the channel refuses, with the field and item", () => {
    const listing = {
      ...draft,
      title: { value: "x".repeat(141), source: "maker" as const },
      tags: {
        value: [
          "wooden cutting board",
          "custom cutting boards",
          "board!",
          "kitchen",
          "Kitchen",
        ],
        source: "maker" as const,
      },
      personalization: {
        value: [
          {
            ...draft.personalization.value[0],
            title: "y".repeat(46),
            instructions: "Type UNIT, SUITE or APT and the number.",
          },
          {
            ...draft.personalization.value[1],
            instructions: "z".repeat(121),
          },
        ],
        source: "maker" as const,
      },
    };
    expect(fields(checkListing(listing, board, rules))).toEqual([
      "error title",
      "warning tags",
      "error tags[1]",
      "error tags[2]",
      "error tags[4]",
      "error personalization[0]",
      "error personalization[0]",
      "error personalization[1]",
    ]);
    const issues = checkListing(listing, board, rules);
    expect(
      issues.find((i) => i.field === "tags" && i.index === 1)?.message,
    ).toBe('"custom cutting boards" has 21 characters; the most is 20.');
  });

  it("advises a short title that says each word once", () => {
    const listing = {
      ...draft,
      title: {
        value:
          "Engraved wood board engraved with your name for the kitchen counter and the dinner table and the holidays too",
        source: "maker" as const,
      },
    };
    const issues = checkListing(listing, board, rules).filter(
      (i) => i.field === "title",
    );
    expect(issues.map((i) => i.severity)).toEqual(["warning", "warning"]);
    expect(issues[1].message).toContain('"engraved"');
  });

  it("a product with no price cannot be listed: the maker sets it, never Kiln", () => {
    const { price: _price, ...unpriced } = board;
    const issues = checkListing(listingDraft(unpriced, rules), unpriced, rules);
    expect(issues).toContainEqual(
      expect.objectContaining({ field: "price", severity: "error" }),
    );
  });
});

describe("refreshListing", () => {
  it("drafts again what is still from the spec; keeps what the model or the maker wrote", () => {
    const stored = {
      ...listingDraft(board, rules),
      title: { value: "My own title", source: "maker" as const },
    };
    const changed = { ...board, material: "end-grain maple" };
    const refreshed = refreshListing(stored, changed, rules);
    expect(refreshed.title.value).toBe("My own title");
    expect(refreshed.materials.value).toEqual(["end-grain maple"]);
  });
});

describe("withCopy", () => {
  it("takes the model's words where the maker wrote none, marked as the model's", () => {
    const stored = {
      ...listingDraft(board, rules),
      tags: { value: ["my own tag"], source: "maker" as const },
    };
    const next = withCopy(stored, {
      title: "A better title",
      description: "A better description.",
      tags: ["model tag"],
      materials: ["maple"],
    });
    expect(next.title).toEqual({ value: "A better title", source: "model" });
    expect(next.materials).toEqual({ value: ["maple"], source: "model" });
    expect(next.tags).toEqual({ value: ["my own tag"], source: "maker" });
    expect(next.personalization).toEqual(stored.personalization);
  });
});

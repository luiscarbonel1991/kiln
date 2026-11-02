import { z } from "zod";
import type { DestinationText } from "@/domain/destination";
import { TREATMENT_LABEL } from "@/domain/exact";
import {
  dimensionsLabel,
  type Product,
  partLabel,
  type Treatment,
} from "@/domain/product";

// A listing's text on a sale destination (ROADMAP Phases 16-17): what the
// maker pastes into the channel's editor beside the photos. Kiln drafts every
// field from the spec for free (listingDraft), a text model may rewrite the
// prose (title, description, tags, materials), the maker edits, and
// checkListing holds it to the channel's rules before anyone pastes it. The
// variations and attributes come from the product alone and are never edited
// here; prices are the maker's (Kiln never computes one).

export const TextSource = z.enum(["spec", "model", "maker"]);
export type TextSource = z.infer<typeof TextSource>;

export const PersonalizationField = z.object({
  title: z.string(),
  required: z.boolean(),
  // The buyer's character limit; null = none set.
  maxChars: z.number().int().positive().nullable(),
  instructions: z.string(),
});
export type PersonalizationField = z.infer<typeof PersonalizationField>;

const sourced = <T extends z.ZodType>(value: T) =>
  z.object({ value, source: TextSource });

export const ListingText = z.object({
  title: sourced(z.string()),
  description: sourced(z.string()),
  tags: sourced(z.array(z.string())),
  materials: sourced(z.array(z.string())),
  personalization: sourced(z.array(PersonalizationField)),
});
export type ListingText = z.infer<typeof ListingText>;
export type ListingField = keyof ListingText;

export interface ListingVariation {
  name: string;
  // Each value carries its own price (the product's price plus its extra).
  pricesVary: boolean;
  values: { label: string; price?: number; inStock: boolean }[];
}

export interface ListingIssue {
  field: ListingField | "price" | "variations";
  index?: number;
  severity: "error" | "warning";
  message: string;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

// The product's variation types, in order: its variant axes, then its colours
// when it has more than one (an out-of-stock colour stays listed, quantity 0,
// never hidden). A value's price is the maker's price plus its extra.
export function listingVariations(product: Product): ListingVariation[] {
  const priced = (extra: number) =>
    product.price === undefined
      ? undefined
      : Number(money(product.price + extra));
  const axes: ListingVariation[] = product.variants.map((axis) => {
    const pricesVary = axis.values.some((v) => v.priceExtra !== 0);
    return {
      name: axis.name,
      pricesVary,
      values: axis.values.map((v) => ({
        label: v.label,
        ...(pricesVary ? { price: priced(v.priceExtra) } : {}),
        inStock: true,
      })),
    };
  });
  if (product.colours.length > 1) {
    axes.push({
      name: "Colour",
      pricesVary: false,
      values: product.colours.map((c) => ({
        label: c.name,
        inStock: c.inStock,
      })),
    });
  }
  return axes;
}

// The product's size as the channel's attributes take it.
export function listingAttributes(
  product: Product,
): { label: string; value: string }[] {
  const { w, h, d, unit } = product.dimensions;
  return [
    { label: "Width", value: `${w} ${unit}` },
    { label: "Height", value: `${h} ${unit}` },
    ...(d ? [{ label: "Depth", value: `${d} ${unit}` }] : []),
  ];
}

const sentence = (text: string) => {
  const t = text.trim().replace(/[.\s]+$/, "");
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : "";
};

function draftTitle(product: Product): string {
  return `${product.name}${product.wording.length > 0 ? ", personalized" : ""}`;
}

// Words written for a buyer, not for an image model: a spec's shape or
// material can be a long visual brief, which the description leaves out.
const SHORT = 60;

function draftDescription(product: Product): string {
  const colours = product.colours
    .map((c) => (c.inStock ? c.name : `${c.name} (out of stock)`))
    .join(", ");
  const brief =
    product.shape.length <= SHORT && product.material.length <= SHORT
      ? [`${product.shape} in ${product.material}`]
      : [];
  // A product of several pieces lists each with its size; one piece, its
  // size (and thickness).
  const sizes = product.parts
    ? product.parts.map(
        (p) =>
          `The ${p.name}: ${partLabel(p, product.dimensions.unit)}${p.colour ? `, ${p.colour.name}` : ""}`,
      )
    : [
        `${dimensionsLabel(product.dimensions)}${product.dimensions.d ? `, ${product.dimensions.d} ${product.dimensions.unit} thick` : ""}`,
      ];
  const gets = [
    ...brief,
    ...sizes,
    product.treatment === "letters"
      ? "Each letter a separate piece, no backing"
      : `${TREATMENT_LABEL[product.treatment]} finish`,
    ...(product.colours.length > 1 ? [`In ${colours}`] : []),
    ...product.variants.map(
      (axis) => `${axis.name}: ${axis.values.map((v) => v.label).join(", ")}`,
    ),
  ];
  const lines = product.wording.map(
    (w) =>
      `${w.label}${w.maxChars ? `: up to ${w.maxChars} characters` : ""}${w.required ? "" : " (optional)"}`,
  );
  const opening = [
    sentence(product.hook ?? product.name),
    ...(product.description ? [sentence(product.description)] : []),
  ];
  return [
    opening.join("\n\n"),
    "",
    "WHAT YOU GET",
    ...gets.map((g) => `· ${sentence(g)}`),
    ...(lines.length > 0
      ? [
          "",
          "PERSONALIZATION",
          ...lines.map((l) => `· ${l}`),
          "Type your text exactly as it should read.",
        ]
      : []),
  ].join("\n");
}

const lower = (s: string) => s.trim().toLowerCase();

const LEADING = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "with",
  "and",
  "for",
  "to",
  "that",
  "its",
]);

// Short phrases for what the product is: each comma part of its name and
// shape, and their last two words ("desk name plate" -> "name plate").
function heads(product: Product): string[] {
  const parts = [product.name, product.shape]
    .flatMap((text) => text.split(","))
    .map(lower)
    .filter(Boolean);
  const short = parts.flatMap((part) => {
    const words = part.split(/\s+/);
    return words.length > 2 ? [part, words.slice(-2).join(" ")] : [part];
  });
  // Never a phrase that starts mid-sentence ("the plate", "of wood").
  return [...new Set(short)].filter(
    (phrase) => !LEADING.has(phrase.split(" ")[0]),
  );
}

// A treatment as a buyer searches for it.
const TAG_WORD: Partial<Record<Treatment, string>> = {
  reveal: "layered",
  letters: "loose",
};

// Phrases from the spec that fit a tag; the text model writes better ones.
function draftTags(product: Product, rules?: DestinationText): string[] {
  const items = heads(product);
  const candidates = [
    ...items,
    lower(product.family),
    ...items.flatMap((item) => [
      `${TAG_WORD[product.treatment] ?? product.treatment} ${item}`,
      ...(product.wording.length > 0
        ? [`custom ${item}`, `personalized ${item}`]
        : []),
      ...product.colours.map((c) => `${lower(c.name).split(" ")[0]} ${item}`),
    ]),
    ...product.useContexts.map((u) => lower(u.split(",")[0])),
  ];
  const fits = (tag: string) =>
    tag.length > 0 &&
    tag.length <= (rules?.tags.maxChars ?? 20) &&
    new RegExp(rules?.tags.pattern ?? "^[\\p{L}\\p{N} '\\-]+$", "u").test(tag);
  return [...new Set(candidates.filter(fits))].slice(
    0,
    rules?.tags.count ?? 13,
  );
}

function draftInstructions(line: Product["wording"][number]): string {
  return `${line.required ? "" : "Optional. "}Type the ${lower(line.label)} exactly as it should read${line.maxChars ? `, up to ${line.maxChars} characters` : ""}.`;
}

// Every field drafted from the spec: free, the same each time.
export function listingDraft(
  product: Product,
  rules?: DestinationText,
): ListingText {
  const spec = <T>(value: T) => ({ value, source: "spec" as const });
  return {
    title: spec(draftTitle(product)),
    description: spec(draftDescription(product)),
    tags: spec(draftTags(product, rules)),
    // A material named in a few words; a long description is left for the
    // maker or the text model to name.
    materials: spec(
      product.material.length <= 45 ? [product.material.trim()] : [],
    ),
    personalization: spec(
      product.wording.map((line) => ({
        title: line.label,
        required: line.required,
        maxChars: line.maxChars,
        instructions: draftInstructions(line),
      })),
    ),
  };
}

// A stored listing brought up to the product: a field still from the spec is
// drafted again; one the model or the maker wrote stays.
export function refreshListing(
  listing: ListingText,
  product: Product,
  rules?: DestinationText,
): ListingText {
  const draft = listingDraft(product, rules);
  return Object.fromEntries(
    (Object.keys(draft) as ListingField[]).map((key) => [
      key,
      listing[key].source === "spec" ? draft[key] : listing[key],
    ]),
  ) as ListingText;
}

// The text model's prose laid over a listing: each field the maker has not
// written takes the model's words (marked so); one the maker wrote stays.
export function withCopy(
  listing: ListingText,
  copy: {
    title: string;
    description: string;
    tags: string[];
    materials: string[];
  },
): ListingText {
  const take = <K extends "title" | "description" | "tags" | "materials">(
    key: K,
  ) =>
    listing[key].source === "maker"
      ? listing[key]
      : { value: copy[key], source: "model" as const };
  return {
    ...listing,
    title: take("title"),
    description: take("description"),
    tags: take("tags"),
    materials: take("materials"),
  };
}

const STOP = new Set(["and", "with", "for", "the", "your", "you", "from"]);

const capsWords = (text: string) =>
  text.split(/[^A-Za-z]+/).filter((w) => w.length >= 2 && w === w.toUpperCase())
    .length;

// The listing against the channel's rules: every problem, in words, with the
// field (and item) it is in. Errors are what the channel refuses; warnings
// are its advice or a field left to fill.
export function checkListing(
  listing: ListingText,
  product: Product,
  rules: DestinationText,
): ListingIssue[] {
  const issues: ListingIssue[] = [];
  const add = (issue: ListingIssue) => issues.push(issue);

  const title = listing.title.value.trim();
  if (!title) {
    add({ field: "title", severity: "error", message: "The title is empty." });
  } else {
    if (title.length > rules.title.maxChars) {
      add({
        field: "title",
        severity: "error",
        message: `${title.length} characters; the most is ${rules.title.maxChars}.`,
      });
    }
    const words = title.split(/\s+/);
    if (
      rules.title.adviseMaxWords &&
      words.length > rules.title.adviseMaxWords
    ) {
      add({
        field: "title",
        severity: "warning",
        message: `${words.length} words; about ${rules.title.adviseMaxWords} or fewer reads best — name the item once, with its colour, material and size.`,
      });
    }
    const seen = new Map<string, number>();
    for (const w of words.map((x) =>
      x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
    )) {
      if (w.length >= 3 && !STOP.has(w)) seen.set(w, (seen.get(w) ?? 0) + 1);
    }
    const repeated = [...seen].filter(([, n]) => n > 1).map(([w]) => w);
    if (repeated.length > 0) {
      add({
        field: "title",
        severity: "warning",
        message: `Repeats ${repeated.map((w) => `"${w}"`).join(", ")}; say each word once.`,
      });
    }
  }

  if (!listing.description.value.trim()) {
    add({
      field: "description",
      severity: "error",
      message: "The description is empty.",
    });
  }

  const tags = listing.tags.value.map((t) => t.trim());
  const pattern = new RegExp(rules.tags.pattern, "u");
  if (tags.length > rules.tags.count) {
    add({
      field: "tags",
      severity: "error",
      message: `${tags.length} tags; the most is ${rules.tags.count}.`,
    });
  } else if (tags.length < rules.tags.count) {
    add({
      field: "tags",
      severity: "warning",
      message: `${tags.length} of ${rules.tags.count} tags; every tag is a way in from search.`,
    });
  }
  tags.forEach((tag, index) => {
    if (tag.length > rules.tags.maxChars) {
      add({
        field: "tags",
        index,
        severity: "error",
        message: `"${tag}" has ${tag.length} characters; the most is ${rules.tags.maxChars}.`,
      });
    }
    if (tag && !pattern.test(tag)) {
      add({
        field: "tags",
        index,
        severity: "error",
        message: `"${tag}" holds a character tags may not (letters, numbers, spaces, - and ' only).`,
      });
    }
    if (tags.findIndex((t) => lower(t) === lower(tag)) !== index) {
      add({
        field: "tags",
        index,
        severity: "error",
        message: `"${tag}" is already a tag.`,
      });
    }
  });

  if (listing.materials.value.length === 0) {
    add({
      field: "materials",
      severity: "warning",
      message:
        "Name the materials in a few words each (a separate search field).",
    });
  }

  const fields = listing.personalization.value;
  if (fields.length > rules.personalization.maxFields) {
    add({
      field: "personalization",
      severity: "error",
      message: `${fields.length} fields; the most is ${rules.personalization.maxFields}.`,
    });
  }
  fields.forEach((f, index) => {
    if (f.title.trim().length > rules.personalization.titleMaxChars) {
      add({
        field: "personalization",
        index,
        severity: "error",
        message: `"${f.title}": a title has at most ${rules.personalization.titleMaxChars} characters.`,
      });
    }
    if (
      f.instructions.trim().length > rules.personalization.instructionsMaxChars
    ) {
      add({
        field: "personalization",
        index,
        severity: "error",
        message: `${f.title}: the instructions have ${f.instructions.trim().length} characters; the most is ${rules.personalization.instructionsMaxChars}.`,
      });
    }
    const caps = capsWords(f.instructions);
    if (caps > rules.personalization.maxCapsWords) {
      add({
        field: "personalization",
        index,
        severity: "error",
        message: `${f.title}: ${caps} words in capitals; the instructions may hold ${rules.personalization.maxCapsWords}.`,
      });
    }
  });

  if (product.price === undefined) {
    add({
      field: "price",
      severity: "error",
      message:
        "The product has no price: add the maker's price to the product (Kiln never sets one).",
    });
  }
  const variations = listingVariations(product);
  if (variations.length > rules.variations.maxTypes) {
    add({
      field: "variations",
      severity: "warning",
      message: `${variations.length} variation types; the channel takes ${rules.variations.maxTypes}. Keep the ones buyers choose.`,
    });
  }
  return issues;
}

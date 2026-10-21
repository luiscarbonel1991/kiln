import { z } from "zod";
import { Treatment, Unit } from "@/domain/product";
import { sizePreview } from "@/lib/product-checks";
import type { FormLimits } from "@/lib/product-form";
import type { ProductReview, ReviewField } from "@/providers/text-prompts";

// The product form's "Review with AI": the form as typed (saved or not) goes
// to the text model field by field; what comes back is kept only where it is a
// field the form has, within its limit, and a change.

const Text = z.string().max(4000);

// The form as the editor holds it, rows in place (an empty line or place keeps
// its index, so a suggestion lands on the row it names). Read leniently: a
// review may run before the form would save.
export const ReviewForm = z.object({
  name: Text.default(""),
  whatItIs: Text.default(""),
  width: z.number().default(0).catch(0),
  height: z.number().default(0).catch(0),
  unit: Unit.default("in").catch("in"),
  material: Text.default(""),
  treatment: Treatment.default("engraved").catch("engraved"),
  colours: z
    .array(z.object({ name: Text.default("") }))
    .max(8)
    .default([]),
  wording: z
    .array(
      z.object({
        label: Text.default(""),
        example: Text.default(""),
        maxChars: z
          .number()
          .int()
          .positive()
          .nullable()
          .default(null)
          .catch(null),
      }),
    )
    .max(3)
    .default([]),
  useContexts: z.array(Text).max(6).default([]),
  hook: Text.default(""),
  cta: Text.default(""),
  description: Text.default(""),
});
export type ReviewForm = z.input<typeof ReviewForm>;

export const MAX_PLACES = 6;
export const HOOK_MAX = 80;
export const CTA_MAX = 40;
const PLACE_MAX = 80;

// The fields the review reads, each with its limit: the size as a check only
// (the maker measures it), and one empty place when there is room, so the
// review may offer where the piece is used.
export function reviewFields(
  input: ReviewForm,
  limits: FormLimits,
): ReviewField[] {
  const form = ReviewForm.parse(input);
  const places = form.useContexts;
  const open =
    places.length < MAX_PLACES && places.every((p) => p.trim()) ? [""] : [];
  return [
    { field: "name", value: form.name, maxChars: limits.name },
    { field: "whatItIs", value: form.whatItIs, maxChars: limits.whatItIs },
    {
      field: "size",
      value: sizePreview(form.width, form.height, form.unit) ?? "",
      checkOnly: true,
    },
    { field: "material", value: form.material, maxChars: limits.material },
    { field: "treatment", value: form.treatment, options: Treatment.options },
    ...form.colours.map((c, i) => ({
      field: `colours.${i}.name`,
      value: c.name,
      maxChars: limits.colourName,
    })),
    ...form.wording.flatMap((w, i) => [
      { field: `wording.${i}.label`, value: w.label, maxChars: limits.label },
      {
        field: `wording.${i}.example`,
        value: w.example,
        maxChars: Math.min(limits.example, w.maxChars ?? limits.example),
      },
      {
        field: `wording.${i}.maxChars`,
        value: w.maxChars ? String(w.maxChars) : "",
      },
    ]),
    ...[...places, ...open].map((p, i) => ({
      field: `useContexts.${i}`,
      value: p,
      maxChars: PLACE_MAX,
    })),
    { field: "hook", value: form.hook, maxChars: HOOK_MAX },
    { field: "cta", value: form.cta, maxChars: CTA_MAX },
    {
      field: "description",
      value: form.description,
      maxChars: limits.description,
    },
  ];
}

export interface Suggestion {
  field: string;
  value: string;
  why: string;
}

export interface Check {
  field: string;
  why: string;
}

export interface CleanReview {
  suggestions: Suggestion[];
  checks: Check[];
}

const MAX_SUGGESTIONS = 8;
const MAX_CHECKS = 4;
const WHY_MAX = 240;

const reason = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > WHY_MAX ? `${t.slice(0, WHY_MAX - 1).trimEnd()}…` : t;
};

// A suggested value as the field takes it: one line, except the description.
const asTyped = (field: string, value: string) =>
  field === "description" ? value.trim() : value.replace(/\s+/g, " ").trim();

// The answer kept where it can be used: a field the form has (not a size),
// within its limit or among its options, a line's maximum a whole number that
// still holds its example, never the value already there; the first per
// field, with its reason in one sentence. Checks keep the first per field.
export function cleanReview(
  review: ProductReview,
  fields: ReviewField[],
): CleanReview {
  const byField = new Map(fields.map((f) => [f.field, f]));
  const seen = new Set<string>();
  const suggestions = review.suggestions.flatMap((s) => {
    const f = byField.get(s.field.trim());
    if (!f || f.checkOnly || seen.has(f.field)) return [];
    const value = asTyped(f.field, s.value);
    const why = reason(s.why);
    if (!value || !why || value === f.value.trim()) return [];
    if (f.maxChars && value.length > f.maxChars) return [];
    if (f.options && !f.options.includes(value)) return [];
    const line = /^wording\.(\d+)\.maxChars$/.exec(f.field);
    if (line) {
      const max = Number(value);
      const example = byField.get(`wording.${line[1]}.example`)?.value ?? "";
      if (!/^\d+$/.test(value) || max < 1 || max > 200) return [];
      if (max < example.trim().length) return [];
    }
    seen.add(f.field);
    return [{ field: f.field, value, why }];
  });
  const checked = new Set<string>();
  const checks = review.checks.flatMap((c) => {
    const f = byField.get(c.field.trim());
    const why = reason(c.why);
    if (!f || !why || checked.has(f.field)) return [];
    checked.add(f.field);
    return [{ field: f.field, why }];
  });
  return {
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    checks: checks.slice(0, MAX_CHECKS),
  };
}

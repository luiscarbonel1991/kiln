import { sizeComparison } from "@/domain/exact";
import type { Unit } from "@/domain/product";
import {
  FORM_LIMITS,
  type FormLimits,
  productFormSchema,
} from "@/lib/product-form";

// Free checks the product form runs as the maker types: no model call, only
// what the spec already says. Each returns words to show, or null.

const fmt = (n: number) => String(Number(n.toFixed(2)));

// "2.3 x 1.25 in (58 x 32 mm) · smaller than a credit card": the size in
// both units beside an everyday object, so a mistyped number reads wrong.
export function sizePreview(
  width: number,
  height: number,
  unit: Unit,
): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  const other =
    unit === "in"
      ? `${Math.round(width * 25.4)} x ${Math.round(height * 25.4)} mm`
      : `${fmt(width / 25.4)} x ${fmt(height / 25.4)} in`;
  const { words } = sizeComparison({ w: width, h: height, unit });
  return `${fmt(width)} x ${fmt(height)} ${unit} (${other}) · ${words}`;
}

// A design's proportions against the size typed.
export function ratioCheck(
  designRatio: number | null,
  width: number,
  height: number,
): string | null {
  if (!designRatio || !(width > 0) || !(height > 0)) return null;
  const typed = width / height;
  if (Math.abs(typed / designRatio - 1) <= 0.03) return null;
  return `Your design is ${designRatio.toFixed(2)}:1; ${fmt(width)} x ${fmt(height)} is ${typed.toFixed(2)}:1.`;
}

// "54/60" once a field is near its limit.
export function counter(value: string, limit: number): string | null {
  const n = value.trim().length;
  return n >= limit * 0.75 ? `${n}/${limit}` : null;
}

export interface LineHint {
  words: string;
  // The label looks like the example: offer to move it there.
  swap?: string;
}

// What a personalization line is missing, in the maker's words.
export function wordingHint(row: {
  label: string;
  example: string;
  maxChars: string;
}): LineHint | null {
  const label = row.label.trim();
  const example = row.example.trim();
  const max = Number(row.maxChars);
  if (!label && example) {
    return { words: "Say what the buyer writes, like “Name”." };
  }
  if (label && !example) {
    return {
      words: "Without an example, How to personalize shows an empty box.",
      swap: label,
    };
  }
  if (max > 0 && example.length > max) {
    return {
      words: `The example has ${example.length} characters; the line takes ${max}.`,
    };
  }
  return null;
}

const NEEDS: [RegExp, string][] = [
  [/^name$/, "a name"],
  [/^whatItIs$/, "what it is"],
  [/^(width|height)$/, "its size"],
  [/^material$/, "its material"],
  [/^colours$/, "a colour"],
  [/^colours\.\d+\.name$/, "a colour's name"],
  [/^wording\.\d+\.label$/, "what the buyer writes"],
];

// What the form still needs before Save, in words ("a name, its size").
export function stillNeeded(
  input: unknown,
  limits: FormLimits = FORM_LIMITS,
): string[] {
  const parsed = productFormSchema(limits).safeParse(input);
  if (parsed.success) return [];
  const words = parsed.error.issues.flatMap((issue) => {
    const path = issue.path.join(".");
    const hit = NEEDS.find(([re]) => re.test(path));
    return hit ? [hit[1]] : [];
  });
  return [...new Set(words)];
}

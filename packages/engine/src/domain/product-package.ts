import { z } from "zod";
import { BrandKit } from "@/domain/brand";
import { colourTextNotes } from "@/domain/colour-text";
import { Product } from "@/domain/product";

// The product package contract (ROADMAP Phase 8, PRODUCT-MODEL.md): what a
// maker's catalog exports and Kiln imports. A package is one Product, an array
// of them, or { maker?, products: [...] }: each product validated by the
// engine's Product schema, the optional `maker` block by BrandKit (the brand
// kit for text layers). Example: the app's /templates/product-package.json.
// In the engine so an exporter can check a package before uploading it (the
// `kiln validate` CLI) with the very checks the import runs.
//
// Products are read one by one: a product that does not parse is set aside
// with its reasons and the others still import, so one long field never
// drops a whole catalog. A maker block that does not parse is left unsaved,
// with its reasons, and the products still import.

export interface RejectedProduct {
  // How the maker knows it: `"DP-W" Desk name plate`, or its place.
  label: string;
  errors: string[];
}

export type PackageResult =
  | {
      ok: true;
      products: Product[];
      rejected: RejectedProduct[];
      brand?: BrandKit;
      brandErrors: string[];
      // What imports but would read wrong, product by product: a colour shown
      // with text written for another (colourTextNotes).
      notes: string[];
    }
  // Nothing in it reads as a package (no products at all).
  | { ok: false; errors: string[] };

// The package as documented ({ maker?, products }), for its JSON Schema: the
// limits (maxLength, maxItems) are the ones the import checks, never a copy.
const PackageShape = z.object({
  maker: BrandKit.optional(),
  products: z.array(Product).min(1),
});

export function packageJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(PackageShape, { io: "input", unrepresentable: "any" }),
    title: "Kiln product package",
    description:
      "One product, a list of them, or { maker, products }. Example: /templates/product-package.json.",
  };
}

type Key = PropertyKey;

function at(value: unknown, path: readonly Key[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      node !== null && typeof node === "object"
        ? (node as Record<Key, unknown>)[key]
        : undefined,
    value,
  );
}

// "colours › oak › inlayName": an array item is named by its key, label or
// name when it has one, else by its place (1-based).
function pathWords(value: unknown, path: readonly Key[]): string {
  return path
    .map((key, i) => {
      if (typeof key !== "number") return String(key);
      const item = at(value, path.slice(0, i + 1));
      const named =
        item !== null && typeof item === "object"
          ? ["key", "label", "name"]
              .map((k) => (item as Record<string, unknown>)[k])
              .find((v) => typeof v === "string" && v.trim() !== "")
          : undefined;
      return typeof named === "string" ? named : `#${key + 1}`;
    })
    .join(" › ");
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One issue in plain words, with what the value was where that helps.
function issueWords(issue: z.core.$ZodIssue, value: unknown): string {
  const got = at(value, issue.path);
  switch (issue.code) {
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string" && typeof got === "string") {
        return `at most ${count(max, "character")} (this one has ${got.length})`;
      }
      if (issue.origin === "array" && Array.isArray(got)) {
        return `at most ${count(max, "item")} (this one has ${got.length})`;
      }
      return `at most ${max}`;
    }
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") {
        return min <= 1 ? "is empty" : `at least ${count(min, "character")}`;
      }
      if (issue.origin === "array") {
        return min <= 1
          ? "needs at least one"
          : `at least ${count(min, "item")}`;
      }
      return `at least ${min}`;
    }
    case "invalid_type":
      return got === undefined
        ? "is missing"
        : `should be a ${issue.expected} (it is ${Array.isArray(got) ? "a list" : `a ${typeof got}`})`;
    case "invalid_value":
      return `should be one of ${issue.values.map(String).join(", ")}`;
    default:
      return issue.message;
  }
}

function issuesWords(issues: z.core.$ZodIssue[], value: unknown): string[] {
  return issues.map((issue) => {
    const where = pathWords(value, issue.path);
    return where
      ? `${where}: ${issueWords(issue, value)}`
      : issueWords(issue, value);
  });
}

// How the maker knows a product in a list: `"DP-W" Desk name plate`.
export function productLabel(product: { sku: string; name: string }): string {
  return `"${product.sku}" ${product.name}`;
}

// Styles are other drawings of a vector product, each with the wording it
// shows: one that could not be drawn, or whose wording breaks the product's
// limits, would only fail later, on a frame.
function styleProblems(product: Product): string[] {
  const styles = product.styles ?? [];
  if (styles.length === 0) return [];
  if (product.source.kind !== "vector") {
    return ["styles need a vector source: Kiln draws each style from its SVG"];
  }
  const seen = new Set<string>();
  return styles.flatMap((style) => {
    const problems: string[] = [];
    if (seen.has(style.key)) {
      problems.push(`styles › ${style.key}: the key appears earlier`);
    }
    seen.add(style.key);
    const examples = style.examples ?? [];
    if (examples.length > product.wording.length) {
      problems.push(
        `styles › ${style.key}: ${examples.length} examples given, the product has ${product.wording.length} wording lines`,
      );
    }
    examples.forEach((text, i) => {
      const line = product.wording[i];
      if (line?.maxChars != null && text.length > line.maxChars) {
        problems.push(
          `styles › ${style.key}: "${line.label}" has ${text.length} characters, max ${line.maxChars}`,
        );
      }
    });
    return problems;
  });
}

function label(raw: unknown, index: number): string {
  const sku = at(raw, ["sku"]);
  const name = at(raw, ["name"]);
  const quoted = typeof sku === "string" && sku.trim() ? `"${sku}"` : null;
  const named = typeof name === "string" && name.trim() ? name : null;
  return [quoted, named].filter(Boolean).join(" ") || `product #${index + 1}`;
}

export function parseProductPackage(input: unknown): PackageResult {
  const isObject =
    input !== null && typeof input === "object" && !Array.isArray(input);
  const list: unknown = Array.isArray(input)
    ? input
    : isObject && "products" in input
      ? (input as { products: unknown }).products
      : isObject
        ? [input]
        : null;
  if (!Array.isArray(list) || list.length === 0) {
    return {
      ok: false,
      errors: [
        "No products found: a package is one product, a list of them, or { maker, products: [...] }.",
      ],
    };
  }

  let brand: BrandKit | undefined;
  let brandErrors: string[] = [];
  const block = isObject ? (input as { maker?: unknown }).maker : undefined;
  if (block !== undefined) {
    const kit = BrandKit.safeParse(block);
    if (kit.success) brand = kit.data;
    else brandErrors = issuesWords(kit.error.issues, block);
  }

  const products: Product[] = [];
  const rejected: RejectedProduct[] = [];
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    const parsed = Product.safeParse(raw);
    if (!parsed.success) {
      rejected.push({
        label: label(raw, index),
        errors: issuesWords(parsed.error.issues, raw),
      });
      return;
    }
    const product = parsed.data;
    const keys = product.colours.map((c) => c.key);
    // A typo in the default colour would import and only fail later, when a
    // frame or a scene needs it.
    const errors = seen.has(product.sku)
      ? [`sku "${product.sku}" appears earlier in the package`]
      : keys.includes(product.defaultColour)
        ? styleProblems(product)
        : [
            `defaultColour "${product.defaultColour}" is not one of its colours (${keys.join(", ")})`,
          ];
    if (errors.length > 0) {
      rejected.push({ label: label(raw, index), errors });
      return;
    }
    seen.add(product.sku);
    products.push(product);
  });

  return {
    ok: true,
    products,
    rejected,
    ...(brand ? { brand } : {}),
    brandErrors,
    notes: products.flatMap((p) =>
      colourTextNotes(p).map((note) => `${productLabel(p)}: ${note}.`),
    ),
  };
}

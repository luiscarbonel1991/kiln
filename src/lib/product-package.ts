import { z } from "zod";
import { Product } from "@/domain/product";

// The product package contract (ROADMAP Phase 8, PRODUCT-MODEL.md): what a
// maker's catalog exports and Kiln imports. A package is one Product, an array
// of them, or { products: [...] }, each validated by the engine's Product
// schema. Example: src/lib/__fixtures__/product-package.json.

export type PackageResult =
  | { ok: true; products: Product[] }
  | { ok: false; errors: string[] };

const MAX_ERRORS = 12;

function format(issues: z.core.$ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => {
    const path = issue.path.reduce<string>(
      (acc, key) =>
        typeof key === "number"
          ? `${acc}[${key}]`
          : acc
            ? `${acc}.${String(key)}`
            : String(key),
      prefix,
    );
    return `${path || "package"}: ${issue.message}`;
  });
}

export function parseProductPackage(input: unknown): PackageResult {
  const [list, prefix] = Array.isArray(input)
    ? [input, ""]
    : input !== null && typeof input === "object" && "products" in input
      ? [(input as { products: unknown }).products, "products"]
      : [[input], ""];
  const parsed = z.array(Product).min(1).safeParse(list);
  if (!parsed.success) {
    return {
      ok: false,
      errors: format(parsed.error.issues, prefix).slice(0, MAX_ERRORS),
    };
  }
  const skus = parsed.data.map((p) => p.sku);
  const repeated = skus.filter((sku, i) => skus.indexOf(sku) !== i);
  if (repeated.length > 0) {
    return {
      ok: false,
      errors: [...new Set(repeated)].map((sku) => `sku "${sku}" appears twice`),
    };
  }
  return { ok: true, products: parsed.data };
}

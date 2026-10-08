import { createHash } from "node:crypto";
import type { Product } from "@/domain/product";
import { canonicalJson } from "@/lib/product-diff";

// A product's version: a hash of its content (everything but Kiln's row id),
// so the same product re-imported keeps its version and any real change
// gives a new one. A project remembers the version it was built from.
export function productHash(product: Product): string {
  const { id: _id, ...content } = product;
  return createHash("sha256")
    .update(canonicalJson(content))
    .digest("hex")
    .slice(0, 16);
}

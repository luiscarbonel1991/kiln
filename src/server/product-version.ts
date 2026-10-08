import { createHash } from "node:crypto";
import { Product } from "@/domain/product";
import { canonicalJson, productChanges } from "@/lib/product-diff";

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

export interface ProductDrift {
  // The project was built from an earlier version of the product: scenes
  // made from now on would still show that version.
  stale: boolean;
  // What changed since, in the maker's words; empty when Kiln cannot tell
  // (a project started before versions were kept).
  changed: string[];
}

// Whether a project's product changed since the project was built from it.
// A project started before versions were kept is judged by the dates: the
// product saved after the project started.
export function productDrift(
  product: Product,
  version: {
    snapshot: unknown;
    hash: string | null;
    productUpdatedAt: Date;
    projectCreatedAt: Date;
  },
): ProductDrift {
  if (version.hash === null) {
    return {
      stale: version.productUpdatedAt > version.projectCreatedAt,
      changed: [],
    };
  }
  if (version.hash === productHash(product)) {
    return { stale: false, changed: [] };
  }
  const before = Product.safeParse(version.snapshot);
  return {
    stale: true,
    changed: before.success ? productChanges(before.data, product) : [],
  };
}

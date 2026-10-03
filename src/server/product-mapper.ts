import { Product } from "@/domain/product";

// Plain row shape — structurally compatible with the Prisma Product model but
// Prisma-free, so the mapping is unit-testable. `sku` and `name` are columns
// (listing, the [makerId, sku] upsert key); `spec` holds the rest of the domain
// Product; `source` is the domain ProductSource. The row id is Kiln's product
// id; a package's own reference lives in `source` (e.g. catalog.ref).
export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  spec: unknown;
  source: unknown;
}

export type ProductWrite = Omit<ProductRow, "id">;

export function productToRow(product: Product): ProductWrite {
  const { id: _id, sku, name, source, ...spec } = product;
  return { sku, name, spec, source };
}

// Tolerant decode, like cards: a row that no longer matches the schema is
// skipped (null), never fatal for the list it is part of.
export function rowToProduct(row: ProductRow): Product | null {
  const parsed = Product.safeParse({
    ...(row.spec as object),
    id: row.id,
    sku: row.sku,
    name: row.name,
    source: row.source,
  });
  return parsed.success ? parsed.data : null;
}

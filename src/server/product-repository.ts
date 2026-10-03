import type { Prisma } from "@prisma/client";
import type { Product } from "@/domain/product";
import { assertDatabaseUrl, db } from "@/lib/db";
import { getCurrentMaker } from "@/server/maker-repository";
import { productToRow, rowToProduct } from "@/server/product-mapper";

const SELECT = {
  id: true,
  sku: true,
  name: true,
  spec: true,
  source: true,
} as const;

// The current maker's products, by name. Rows that no longer parse are skipped.
export async function listProducts(): Promise<Product[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.product.findMany({
    where: { makerId: maker.id },
    select: SELECT,
    orderBy: { name: "asc" },
  });
  return rows.flatMap((row) => {
    const product = rowToProduct(row);
    return product ? [product] : [];
  });
}

export async function getProduct(id: string): Promise<Product | null> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const row = await db.product.findFirst({
    where: { id, makerId: maker.id },
    select: SELECT,
  });
  return row ? rowToProduct(row) : null;
}

// Insert or update by [makerId, sku], so re-importing a package keeps each
// product's id (and every project that uses it). All or nothing.
export async function upsertProducts(products: Product[]): Promise<Product[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.$transaction(
    products.map((product) => {
      const { sku, name, spec, source } = productToRow(product);
      const json = {
        name,
        spec: spec as Prisma.InputJsonValue,
        source: source as Prisma.InputJsonValue,
      };
      return db.product.upsert({
        where: { makerId_sku: { makerId: maker.id, sku } },
        create: { makerId: maker.id, sku, ...json },
        update: json,
        select: SELECT,
      });
    }),
  );
  return rows.flatMap((row) => {
    const product = rowToProduct(row);
    return product ? [product] : [];
  });
}

import type { Prisma } from "@prisma/client";
import type { BrandKit } from "@/domain/brand";
import type { Product } from "@/domain/product";
import { assertDatabaseUrl, db } from "@/lib/db";
import { productChanges } from "@/lib/product-diff";
import { getCurrentMaker } from "@/server/maker-repository";
import { productToRow, rowToProduct } from "@/server/product-mapper";
import { productHash } from "@/server/product-version";

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

export interface ImportedProduct {
  product: Product;
  status: "new" | "updated" | "unchanged";
  // What an update changed, in the maker's words (product-diff.ts).
  changed: string[];
}

// Import a catalog: each product inserted, updated in place by
// [makerId, sku] (its id and every project using it stay), or left alone when
// its content is the same (so `updatedAt` means a real change), with the
// brand kit in the same transaction. All or nothing.
export async function importCatalog(
  products: Product[],
  brand?: BrandKit,
): Promise<ImportedProduct[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  return db.$transaction(async (tx) => {
    const existing = await tx.product.findMany({
      where: { makerId: maker.id, sku: { in: products.map((p) => p.sku) } },
      select: SELECT,
    });
    const bySku = new Map(existing.map((row) => [row.sku, rowToProduct(row)]));
    const imported: ImportedProduct[] = [];
    for (const product of products) {
      const before = bySku.get(product.sku);
      const { sku, name, spec, source } = productToRow(product);
      const json = {
        name,
        spec: spec as Prisma.InputJsonValue,
        source: source as Prisma.InputJsonValue,
      };
      if (before && productHash(before) === productHash(product)) {
        imported.push({ product: before, status: "unchanged", changed: [] });
        continue;
      }
      const row = await tx.product.upsert({
        where: { makerId_sku: { makerId: maker.id, sku } },
        create: { makerId: maker.id, sku, ...json },
        update: json,
        select: SELECT,
      });
      const saved = rowToProduct(row);
      if (!saved) continue;
      imported.push(
        bySku.has(sku)
          ? {
              product: saved,
              status: "updated",
              // A stored row that no longer reads has nothing to compare.
              changed: before ? productChanges(before, saved) : [],
            }
          : { product: saved, status: "new", changed: [] },
      );
    }
    if (brand) {
      await tx.maker.update({
        where: { id: maker.id },
        data: { brand: brand as unknown as Prisma.InputJsonValue },
      });
    }
    return imported;
  });
}

// Save an edited product over its own row (the sku is the row's, whatever
// the name), or leave it alone when its content is the same, so a project
// is never marked behind for nothing. Says what changed.
export async function updateProduct(
  id: string,
  product: Product,
): Promise<ImportedProduct> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  return db.$transaction(async (tx) => {
    const row = await tx.product.findFirst({
      where: { id, makerId: maker.id },
      select: SELECT,
    });
    const before = row ? rowToProduct(row) : null;
    if (!row || !before) throw new Error("That product no longer exists.");
    if (productHash(before) === productHash(product)) {
      return { product: before, status: "unchanged", changed: [] };
    }
    const { name, spec, source } = productToRow({ ...product, sku: row.sku });
    const updated = await tx.product.update({
      where: { id },
      data: {
        name,
        spec: spec as Prisma.InputJsonValue,
        source: source as Prisma.InputJsonValue,
      },
      select: SELECT,
    });
    const saved = rowToProduct(updated);
    if (!saved) throw new Error("The product could not be read back.");
    return {
      product: saved,
      status: "updated",
      changed: productChanges(before, saved),
    };
  });
}

export interface ProductUse {
  projectId: string;
  name: string;
  // The version the project follows (null: from before versions).
  hash: string | null;
}

// The projects that use a product, by name.
export async function productProjects(id: string): Promise<ProductUse[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const links = await db.projectProduct.findMany({
    where: { productId: id, project: { makerId: maker.id } },
    select: {
      productHash: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { project: { name: "asc" } },
  });
  return links.map((l) => ({
    projectId: l.project.id,
    name: l.project.name,
    hash: l.productHash,
  }));
}

// Delete a product no project uses; otherwise say which projects do.
export async function deleteProduct(
  id: string,
): Promise<{ deleted: true } | { usedBy: ProductUse[] }> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const usedBy = await productProjects(id);
  if (usedBy.length > 0) return { usedBy };
  try {
    const { count } = await db.product.deleteMany({
      where: { id, makerId: maker.id },
    });
    if (count === 0) throw new Error("That product no longer exists.");
    return { deleted: true };
  } catch (error) {
    // A project started from it in between: the foreign key refuses.
    if ((error as { code?: string }).code === "P2003") {
      return { usedBy: await productProjects(id) };
    }
    throw error;
  }
}

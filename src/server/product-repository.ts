import type { Prisma } from "@prisma/client";
import type { BrandKit } from "@/domain/brand";
import type { Product } from "@/domain/product";
import { assertDatabaseUrl, db } from "@/lib/db";
import { keepSwatches } from "@/lib/kept-swatches";
import { productChanges } from "@/lib/product-diff";
import type { MakerRef } from "@/server/maker-repository";
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
export async function listProducts(maker: MakerRef): Promise<Product[]> {
  assertDatabaseUrl();
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

export async function getProduct(
  maker: MakerRef,
  id: string,
): Promise<Product | null> {
  assertDatabaseUrl();
  const row = await db.product.findFirst({
    where: { id, makerId: maker.id },
    select: SELECT,
  });
  return row ? rowToProduct(row) : null;
}

// A product by Kiln's id or, failing that, by its sku: what an API caller
// knows of it.
export async function findProduct(
  maker: MakerRef,
  ref: string,
): Promise<Product | null> {
  assertDatabaseUrl();
  const row =
    (await db.product.findFirst({
      where: { id: ref, makerId: maker.id },
      select: SELECT,
    })) ??
    (await db.product.findFirst({
      where: { sku: ref, makerId: maker.id },
      select: SELECT,
    }));
  return row ? rowToProduct(row) : null;
}

// Insert or update by [makerId, sku], so re-importing a package keeps each
// product's id (and every project that uses it). All or nothing.
export async function upsertProducts(
  maker: MakerRef,
  products: Product[],
): Promise<Product[]> {
  assertDatabaseUrl();
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
  // The colours whose material photo was kept because the package gives
  // none (kept-swatches.ts).
  kept?: string[];
}

// Import a catalog: each product inserted, updated in place by
// [makerId, sku] (its id and every project using it stay), or left alone when
// its content is the same (so `updatedAt` means a real change), with the
// brand kit in the same transaction. A material photo the package does not
// give is kept. All or nothing.
export async function importCatalog(
  maker: MakerRef,
  products: Product[],
  brand?: BrandKit,
): Promise<ImportedProduct[]> {
  assertDatabaseUrl();
  const skus = products.map((p) => p.sku);
  return db.$transaction(async (tx) => {
    // The rows being replaced are locked first: a material photo set at the
    // same moment (setSwatchUrl) waits, and is then read by keepSwatches.
    await tx.$queryRaw`
      SELECT "id" FROM "Product"
      WHERE "makerId" = ${maker.id} AND "sku" = ANY(${skus})
      FOR UPDATE`;
    const existing = await tx.product.findMany({
      where: { makerId: maker.id, sku: { in: skus } },
      select: SELECT,
    });
    const bySku = new Map(existing.map((row) => [row.sku, rowToProduct(row)]));
    const imported: ImportedProduct[] = [];
    for (const incoming of products) {
      const before = bySku.get(incoming.sku);
      const { product, kept } = keepSwatches(incoming, before);
      const keptNote = kept.length > 0 ? { kept } : {};
      const { sku, name, spec, source } = productToRow(product);
      const json = {
        name,
        spec: spec as Prisma.InputJsonValue,
        source: source as Prisma.InputJsonValue,
      };
      if (before && productHash(before) === productHash(product)) {
        imported.push({
          product: before,
          status: "unchanged",
          changed: [],
          ...keptNote,
        });
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
              ...keptNote,
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
  maker: MakerRef,
  id: string,
  product: Product,
): Promise<ImportedProduct> {
  assertDatabaseUrl();
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

// One colour's material photo set (a stored URL) or removed (null), read and
// written under the product's row lock, so photos sent at once for two
// colours both land, and an import waits for it. Unchanged when the colour
// already reads so; null when the product or the colour is not there.
export async function setSwatchUrl(
  maker: MakerRef,
  id: string,
  key: string,
  swatchUrl: string | null,
): Promise<ImportedProduct | null> {
  assertDatabaseUrl();
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Product"
      WHERE "id" = ${id} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) return null;
    const row = await tx.product.findUniqueOrThrow({
      where: { id },
      select: SELECT,
    });
    const before = rowToProduct(row);
    if (!before?.colours.some((c) => c.key === key)) return null;
    const after: Product = {
      ...before,
      colours: before.colours.map((c) => {
        if (c.key !== key) return c;
        const { swatchUrl: _previous, ...bare } = c;
        return swatchUrl ? { ...bare, swatchUrl } : bare;
      }),
    };
    if (productHash(before) === productHash(after)) {
      return { product: before, status: "unchanged", changed: [] };
    }
    const { spec } = productToRow(after);
    const updated = await tx.product.update({
      where: { id },
      data: { spec: spec as Prisma.InputJsonValue },
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
export async function productProjects(
  maker: MakerRef,
  id: string,
): Promise<ProductUse[]> {
  assertDatabaseUrl();
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
  maker: MakerRef,
  id: string,
): Promise<{ deleted: true } | { usedBy: ProductUse[] }> {
  assertDatabaseUrl();
  const usedBy = await productProjects(maker, id);
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
      return { usedBy: await productProjects(maker, id) };
    }
    throw error;
  }
}

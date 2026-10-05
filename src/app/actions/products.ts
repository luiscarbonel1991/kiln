"use server";

import type { Product } from "@/domain/product";
import { type PackageResult, parseProductPackage } from "@/lib/product-package";
import { saveMakerBrand } from "@/server/maker-repository";
import { listProducts, upsertProducts } from "@/server/product-repository";

// Server Functions are POST-reachable: the package parse is the trust boundary.

export async function listProductsAction(): Promise<Product[]> {
  return listProducts();
}

// Import a product package for the current maker. Re-importing a sku updates
// that product in place (its id, and every project using it, stay); a `maker`
// block replaces the maker's brand kit.
export async function importProductsAction(
  input: unknown,
): Promise<PackageResult> {
  const parsed = parseProductPackage(input);
  if (!parsed.ok) return parsed;
  const products = await upsertProducts(parsed.products);
  if (parsed.brand) await saveMakerBrand(parsed.brand);
  return { ...parsed, products };
}

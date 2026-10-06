"use server";

import type { Product } from "@/domain/product";
import { type PackageResult, parseProductPackage } from "@/lib/product-package";
import { assertAllowedAssetUrl } from "@/providers/asset-bytes";
import { saveMakerBrand } from "@/server/maker-repository";
import { listProducts, upsertProducts } from "@/server/product-repository";

// Server Functions are POST-reachable: the package parse is the trust boundary.

export async function listProductsAction(): Promise<Product[]> {
  return listProducts();
}

// The address a product's source asset is fetched from, if it has one.
function sourceUrl(product: Product): string | null {
  if (product.source.kind === "vector") return product.source.svgUrl;
  if (product.source.kind === "photo") return product.source.assetUrl;
  return null;
}

// A package whose assets live where Kiln will not fetch is refused at import,
// not later when a plate or a scene needs them.
function blockedAssets(products: Product[]): string[] {
  return products.flatMap((product) => {
    const url = sourceUrl(product);
    if (!url) return [];
    try {
      assertAllowedAssetUrl(url);
      return [];
    } catch (error) {
      return [`sku "${product.sku}": ${(error as Error).message}`];
    }
  });
}

// Import a product package for the current maker. Re-importing a sku updates
// that product in place (its id, and every project using it, stay); a `maker`
// block replaces the maker's brand kit.
export async function importProductsAction(
  input: unknown,
): Promise<PackageResult> {
  const parsed = parseProductPackage(input);
  if (!parsed.ok) return parsed;
  const blocked = blockedAssets(parsed.products);
  if (blocked.length > 0) return { ok: false, errors: blocked };
  const products = await upsertProducts(parsed.products);
  if (parsed.brand) await saveMakerBrand(parsed.brand);
  return { ...parsed, products };
}

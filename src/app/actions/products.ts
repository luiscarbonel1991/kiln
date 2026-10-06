"use server";

import type { Product } from "@/domain/product";
import { type PackageResult, parseProductPackage } from "@/lib/product-package";
import { assertAllowedAssetUrl, fetchAsset } from "@/providers/asset-bytes";
import { measureOutline } from "@/providers/plates/svg";
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

// A vector product's outline, measured from its SVG (never taken from the
// package): exact frames draw it to scale. A drawing that does not match the
// declared dimensions is imported without one (its frames draw the spec's
// outline) and reported.
async function withOutline(
  product: Product,
): Promise<{ product: Product; warning?: string }> {
  if (product.source.kind !== "vector") return { product };
  const { outlineBox: _ignored, ...source } = product.source;
  const bare = { ...product, source };
  try {
    const { bytes } = await fetchAsset(source.svgUrl);
    const measured = measureOutline(
      bytes.toString("utf8"),
      product.dimensions,
      source.scalePxPerUnit,
    );
    if ("box" in measured) {
      return {
        product: {
          ...product,
          source: { ...source, outlineBox: measured.box },
        },
      };
    }
    return {
      product: bare,
      warning: `sku "${product.sku}": ${measured.mismatch}; its scale frames draw the outline from the spec.`,
    };
  } catch (error) {
    return {
      product: bare,
      warning: `sku "${product.sku}": its SVG could not be measured (${(error as Error).message}); its scale frames draw the outline from the spec.`,
    };
  }
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
  const measured = await Promise.all(parsed.products.map(withOutline));
  const warnings = measured.flatMap((m) => (m.warning ? [m.warning] : []));
  const products = await upsertProducts(measured.map((m) => m.product));
  if (parsed.brand) await saveMakerBrand(parsed.brand);
  return { ...parsed, products, ...(warnings.length > 0 ? { warnings } : {}) };
}

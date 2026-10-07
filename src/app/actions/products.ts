"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import { defaultTextModel, ProviderId } from "@/domain/model-defaults";
import type { Product } from "@/domain/product";
import { ProductForm, productFromForm } from "@/lib/product-form";
import { type PackageResult, parseProductPackage } from "@/lib/product-package";
import {
  assertAllowedAssetUrl,
  fetchAsset,
  storeAsset,
} from "@/providers/asset-bytes";
import { measureOutline } from "@/providers/plates/svg";
import type { ProductDraft } from "@/providers/text-prompts";
import { getMakerModels, saveMakerBrand } from "@/server/maker-repository";
import {
  ProductFileRefused,
  type StoredProductFile,
  storeProductPhoto,
  storeProductSvg,
} from "@/server/product-files";
import { listProducts, upsertProducts } from "@/server/product-repository";
import { type Degraded, draftProduct } from "@/server/text-calls";

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

// A photo given inline (a data: URL) is moved to Kiln's storage: a scene's
// reference must be a stored image, as the New project page promises.
async function withStoredPhoto(product: Product): Promise<Product> {
  if (
    product.source.kind !== "photo" ||
    !product.source.assetUrl.startsWith("data:")
  ) {
    return product;
  }
  const photo = await fetchAsset(product.source.assetUrl);
  const assetUrl = await storeAsset(photo.bytes, photo.mime, "products");
  return { ...product, source: { kind: "photo", assetUrl } };
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
  const stored = await Promise.all(parsed.products.map(withStoredPhoto));
  const measured = await Promise.all(stored.map(withOutline));
  const warnings = measured.flatMap((m) => (m.warning ? [m.warning] : []));
  const products = await upsertProducts(measured.map((m) => m.product));
  if (parsed.brand) await saveMakerBrand(parsed.brand);
  return { ...parsed, products, ...(warnings.length > 0 ? { warnings } : {}) };
}

const PHOTO_MIME = new Set<string>(ACCEPTED_IMAGE_MIME);

// The product form's file: a photo (PNG, JPEG, WebP) or the SVG of a design,
// stored with what the form can prefill (its colours; a design's proportions).
// FormData, because it carries a file; refusals come back as words.
export async function uploadProductFileAction(
  formData: FormData,
): Promise<StoredProductFile | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file was sent." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "That file is larger than 15 MB." };
  }
  const isSvg =
    file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
  try {
    if (isSvg) return await storeProductSvg(await file.text());
    if (PHOTO_MIME.has(file.type)) {
      return await storeProductPhoto(
        new Uint8Array(await file.arrayBuffer()),
        file.type,
      );
    }
  } catch (error) {
    if (error instanceof ProductFileRefused) return { error: error.message };
    throw error;
  }
  return { error: "Use a photo (PNG, JPEG, WebP) or an SVG design." };
}

// Save the product the form describes, through the same checks as an import
// (its file where Kiln fetches, a design's outline measured against its size).
export async function createProductAction(
  input: unknown,
): Promise<{ product: Product; warning?: string } | { error: string }> {
  const parsed = ProductForm.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const product = productFromForm(
    parsed.data,
    randomBytes(3).readUIntBE(0, 3).toString(36).slice(0, 4),
  );
  const blocked = blockedAssets([product]);
  if (blocked.length > 0) {
    return { error: "That file is not in Kiln's storage; upload it again." };
  }
  const measured = await withOutline(product);
  const [saved] = await upsertProducts([measured.product]);
  return {
    product: saved,
    ...(measured.warning
      ? { warning: measured.warning.replace(/^sku "[^"]+": /, "") }
      : {}),
  };
}

const Draft = z.object({
  assetUrl: z.string().min(1),
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// "Fill from the photo": the product form drafted from the uploaded photo by
// the maker's text model (or the one the degraded notice offers), under the
// monthly cap. The photo must be in Kiln's storage.
export async function draftProductAction(
  input: unknown,
): Promise<{ draft?: ProductDraft; degraded?: Degraded; error?: string }> {
  const parsed = Draft.safeParse(input);
  if (!parsed.success) return { error: "Upload the photo first." };
  try {
    assertAllowedAssetUrl(parsed.data.assetUrl);
  } catch {
    return { error: "Upload the photo first." };
  }
  return draftProduct(
    parsed.data.assetUrl,
    parsed.data.model ?? defaultTextModel(await getMakerModels()),
  );
}

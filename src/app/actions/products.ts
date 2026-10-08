"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import type { BrandKit } from "@/domain/brand";
import { defaultTextModel, ProviderId } from "@/domain/model-defaults";
import type { Product } from "@/domain/product";
import { ProductForm, productFromForm } from "@/lib/product-form";
import {
  parseProductPackage,
  productLabel,
  type RejectedProduct,
} from "@/lib/product-package";
import {
  assertAllowedAssetUrl,
  fetchAsset,
  storeAsset,
} from "@/providers/asset-bytes";
import { measureOutline } from "@/providers/plates/svg";
import type { ProductDraft } from "@/providers/text-prompts";
import { getMakerModels } from "@/server/maker-repository";
import {
  ProductFileRefused,
  type StoredProductFile,
  storeProductPhoto,
  storeProductSvg,
} from "@/server/product-files";
import {
  type ImportedProduct,
  importCatalog,
  listProducts,
  upsertProducts,
} from "@/server/product-repository";
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

// A product whose asset lives where Kiln will not fetch is refused at import,
// not later when a plate or a scene needs it: the reason, or null.
function blockedAsset(product: Product): string | null {
  const url = sourceUrl(product);
  if (!url) return null;
  try {
    assertAllowedAssetUrl(url);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
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
      warning: `${measured.mismatch}; its scale frames draw the outline from the spec.`,
    };
  } catch (error) {
    return {
      product: bare,
      warning: `its SVG could not be measured (${(error as Error).message}); its scale frames draw the outline from the spec.`,
    };
  }
}

// A photo given inline (a data: URL) is moved to Kiln's storage: a scene's
// reference must be a stored image, as the New project page promises. Named
// by its bytes, so re-importing the same photo keeps the product unchanged.
async function withStoredPhoto(product: Product): Promise<Product> {
  if (
    product.source.kind !== "photo" ||
    !product.source.assetUrl.startsWith("data:")
  ) {
    return product;
  }
  const photo = await fetchAsset(product.source.assetUrl);
  const assetUrl = await storeAsset(photo.bytes, photo.mime, "products", {
    byContent: true,
  });
  return { ...product, source: { kind: "photo", assetUrl } };
}

// Scenes show a product in its default colour: one out of stock would sell a
// look the maker cannot ship.
function outOfStockDefault(product: Product): string | null {
  const colour = product.colours.find((c) => c.key === product.defaultColour);
  return colour && !colour.inStock
    ? `${productLabel(product)}: its default colour, ${colour.name}, is out of stock, and scenes show the default colour. Pick one in stock as defaultColour.`
    : null;
}

export interface ImportResult {
  imported: ImportedProduct[];
  // Products set aside, each with why; the others imported.
  rejected: RejectedProduct[];
  brand?: BrandKit;
  // Why the maker block was not saved.
  brandErrors: string[];
  warnings: string[];
}

// Import a product package for the current maker, product by product: the
// valid ones are saved (re-importing a sku updates that product in place —
// its id, and every project using it, stay — and says what changed), the
// others come back with their reasons; a `maker` block replaces the maker's
// brand kit.
export async function importProductsAction(
  input: unknown,
): Promise<ImportResult | { error: string }> {
  const parsed = parseProductPackage(input);
  if (!parsed.ok) return { error: parsed.errors.join(" ") };
  const rejected = [...parsed.rejected];
  const ready: Product[] = [];
  for (const product of parsed.products) {
    const blocked = blockedAsset(product);
    if (blocked) {
      rejected.push({ label: productLabel(product), errors: [blocked] });
      continue;
    }
    try {
      ready.push(await withStoredPhoto(product));
    } catch (error) {
      rejected.push({
        label: productLabel(product),
        errors: [`its photo could not be read (${(error as Error).message})`],
      });
    }
  }
  const measured = await Promise.all(ready.map(withOutline));
  const warnings = [
    ...measured.flatMap((m) =>
      m.warning ? [`${productLabel(m.product)}: ${m.warning}`] : [],
    ),
    ...ready.flatMap((p) => {
      const warning = outOfStockDefault(p);
      return warning ? [warning] : [];
    }),
  ];
  let imported: ImportedProduct[] = [];
  if (measured.length > 0 || parsed.brand) {
    try {
      imported = await importCatalog(
        measured.map((m) => m.product),
        parsed.brand,
      );
    } catch (error) {
      return { error: `Nothing was saved: ${(error as Error).message}` };
    }
  }
  return {
    imported,
    rejected,
    ...(parsed.brand ? { brand: parsed.brand } : {}),
    brandErrors: parsed.brandErrors,
    warnings,
  };
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
  if (blockedAsset(product)) {
    return { error: "That file is not in Kiln's storage; upload it again." };
  }
  const measured = await withOutline(product);
  const [saved] = await upsertProducts([measured.product]);
  return {
    product: saved,
    ...(measured.warning ? { warning: measured.warning } : {}),
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

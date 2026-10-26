"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import type { BrandKit } from "@/domain/brand";
import {
  defaultTextModel,
  modelLabel,
  ProviderId,
} from "@/domain/model-defaults";
import type { Product } from "@/domain/product";
import {
  parseProductPackage,
  productLabel,
  type RejectedProduct,
} from "@/domain/product-package";
import {
  editLimits,
  FORM_LIMITS,
  type FormIssue,
  formIssues,
  mergeForm,
  ProductForm,
  productFromForm,
} from "@/lib/product-form";
import {
  type CleanReview,
  cleanReview,
  ReviewForm,
  reviewFields,
} from "@/lib/product-review";
import { sanitizeSvg } from "@/lib/svg-sanitize";
import {
  assertAllowedAssetUrl,
  fetchAsset,
  storeAsset,
} from "@/providers/asset-bytes";
import { measureOutline, rasterize } from "@/providers/plates/svg";
import type { ProductDraft } from "@/providers/text-prompts";
import { getMakerModels } from "@/server/maker-repository";
import {
  ProductFileRefused,
  type StoredProductFile,
  storeProductPhoto,
  storeProductSvg,
} from "@/server/product-files";
import {
  deleteProduct,
  getProduct,
  type ImportedProduct,
  importCatalog,
  listProducts,
  productProjects,
  updateProduct,
  upsertProducts,
} from "@/server/product-repository";
import { productHash } from "@/server/product-version";
import {
  type Degraded,
  draftProduct,
  reviewProduct,
} from "@/server/text-calls";

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

// A product whose assets live where Kiln will not fetch is refused at import,
// not later when a plate or a scene needs them: the reason, or null. Its
// source, each colour's material sample and each view.
function blockedAsset(product: Product): string | null {
  const source = sourceUrl(product);
  const urls = [
    ...(source ? [{ where: null, url: source }] : []),
    ...product.colours.flatMap((c) =>
      c.swatchUrl
        ? [{ where: `colours › ${c.key} › swatchUrl`, url: c.swatchUrl }]
        : [],
    ),
    ...(product.views ?? []).map((v) => ({
      where: `views › ${v.label} › url`,
      url: v.url,
    })),
  ];
  for (const { where, url } of urls) {
    try {
      assertAllowedAssetUrl(url);
    } catch (error) {
      const reason = (error as Error).message;
      return where ? `${where}: ${reason}` : reason;
    }
  }
  return null;
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

const RASTER = new Set(["image/png", "image/jpeg", "image/webp"]);

// An image given inline (a data: URL) — the product's photo, a colour's
// material sample — is moved to Kiln's storage: a scene's reference must be a
// stored image, as the New project page promises. Named by its bytes, so
// re-importing the same image keeps the product unchanged. A sample goes to
// the image model, so it must be a photo, never an SVG.
async function storedInline(url: string, what: string): Promise<string> {
  if (!url.startsWith("data:")) return url;
  const image = await fetchAsset(url);
  if (!RASTER.has(image.mime)) {
    throw new Error(`${what} must be a PNG, JPEG or WebP image`);
  }
  return storeAsset(image.bytes, image.mime, "products", { byContent: true });
}

// The ground a view drawing is rendered on: the reference plate's.
const VIEW_GROUND = "#F0EEE9";

// A view goes to the image model beside the reference, so it must be a
// raster in Kiln's storage: an inline image is stored by its bytes, an SVG
// drawing (inline or fetched) is cleaned and rendered to PNG on the plate's
// ground. A raster already at an allowed address stays where it is.
async function storedView(url: string, label: string): Promise<string> {
  const image = await fetchAsset(url);
  if (image.mime === "image/svg+xml") {
    const clean = sanitizeSvg(image.bytes.toString("utf8"));
    if (!clean)
      throw new Error(`the ${label} view is not a drawing Kiln can read`);
    const png = rasterize(clean, 1024, VIEW_GROUND);
    return storeAsset(png, "image/png", "products", { byContent: true });
  }
  if (!RASTER.has(image.mime)) {
    throw new Error(`the ${label} view must be a PNG, JPEG, WebP or SVG image`);
  }
  return url.startsWith("data:")
    ? storeAsset(image.bytes, image.mime, "products", { byContent: true })
    : url;
}

async function withStoredImages(product: Product): Promise<Product> {
  const source =
    product.source.kind === "photo"
      ? {
          kind: "photo" as const,
          assetUrl: await storedInline(product.source.assetUrl, "its photo"),
        }
      : product.source;
  const colours = await Promise.all(
    product.colours.map(async (c) =>
      c.swatchUrl
        ? {
            ...c,
            swatchUrl: await storedInline(
              c.swatchUrl,
              `the ${c.name} material sample`,
            ),
          }
        : c,
    ),
  );
  const views = product.views
    ? await Promise.all(
        product.views.map(async (v) => ({
          ...v,
          url: await storedView(v.url, v.label),
        })),
      )
    : undefined;
  return { ...product, source, colours, ...(views ? { views } : {}) };
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
      ready.push(await withStoredImages(product));
    } catch (error) {
      rejected.push({
        label: productLabel(product),
        errors: [`an image could not be stored: ${(error as Error).message}`],
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
): Promise<
  | { product: Product; warning?: string }
  | { error: string; issues?: FormIssue[] }
> {
  const parsed = ProductForm.safeParse(input);
  if (!parsed.success) {
    const issues = formIssues(input);
    return { error: issues[0]?.message ?? "Check the form.", issues };
  }
  const product = productFromForm(
    parsed.data,
    randomBytes(3).readUIntBE(0, 3).toString(36).slice(0, 4),
  );
  if (blockedAsset(product)) {
    return { error: "That file is not in Kiln's storage; upload it again." };
  }
  let stored: Product;
  try {
    // A view uploaded as an SVG design is rendered to PNG here.
    stored = await withStoredImages(product);
  } catch (error) {
    return {
      error: `An image could not be stored: ${(error as Error).message}`,
    };
  }
  const measured = await withOutline(stored);
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

const Review = z.object({
  form: ReviewForm,
  // The saved product being edited: its own limits apply.
  productId: z.string().min(1).optional(),
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// "Review with AI": the form as typed, saved or not, reviewed by the maker's
// text model (or the one the degraded notice offers) under the cap. Returns
// the suggestions the form can take and the checks, with the model's name;
// nothing is saved.
export async function reviewProductAction(input: unknown): Promise<{
  review?: CleanReview & { model: string };
  degraded?: Degraded;
  error?: string;
}> {
  const parsed = Review.safeParse(input);
  if (!parsed.success) return { error: "Nothing to review yet." };
  const { form, productId, model } = parsed.data;
  if (!form.name.trim() && !form.whatItIs.trim()) {
    return { error: "Name the product or say what it is first." };
  }
  const stored = productId ? await getProduct(productId) : null;
  const fields = reviewFields(form, stored ? editLimits(stored) : FORM_LIMITS);
  const textModel = model ?? defaultTextModel(await getMakerModels());
  const result = await reviewProduct(fields, textModel);
  if (!result.review) return { degraded: result.degraded };
  return {
    review: {
      ...cleanReview(result.review, fields),
      model: modelLabel(textModel),
    },
  };
}

const Edit = z.object({ id: z.string().min(1), form: z.unknown() });

// Save an edited product over itself, through the same checks as a new one.
// Says what changed and which projects still follow an earlier version (each
// offers its update on its board). A product from a catalog connector is
// changed in the catalog, not here.
export async function updateProductAction(input: unknown): Promise<
  | {
      product: Product;
      status: ImportedProduct["status"];
      changed: string[];
      behind: { projectId: string; name: string }[];
      warning?: string;
    }
  | { error: string; issues?: FormIssue[] }
> {
  const { id, form } = Edit.parse(input);
  const stored = await getProduct(id);
  if (!stored) return { error: "That product no longer exists." };
  if (stored.source.kind === "catalog") {
    return {
      error:
        "This product comes from your catalog: change it there and import it again.",
    };
  }
  const merged = mergeForm(stored, form as ProductForm);
  if ("error" in merged) return merged;
  if (blockedAsset(merged.product)) {
    return { error: "That file is not in Kiln's storage; upload it again." };
  }
  let withImages: Product;
  try {
    withImages = await withStoredImages(merged.product);
  } catch (error) {
    return {
      error: `An image could not be stored: ${(error as Error).message}`,
    };
  }
  const measured = await withOutline(withImages);
  const saved = await updateProduct(id, measured.product);
  const now = productHash(saved.product);
  const behind = (await productProjects(id))
    .filter((use) => use.hash !== now)
    .map(({ projectId, name }) => ({ projectId, name }));
  return {
    ...saved,
    behind,
    ...(measured.warning ? { warning: measured.warning } : {}),
  };
}

// Delete a product no project uses; otherwise say which projects do.
export async function deleteProductAction(
  input: unknown,
): Promise<
  | { deleted: true }
  | { error: string; usedBy?: { projectId: string; name: string }[] }
> {
  const id = z.string().min(1).parse(input);
  try {
    const result = await deleteProduct(id);
    if ("deleted" in result) return result;
    const names = result.usedBy.map((u) => u.name).join(", ");
    return {
      error: `Used by ${names}: delete ${result.usedBy.length === 1 ? "that project" : "those projects"} first.`,
      usedBy: result.usedBy.map(({ projectId, name }) => ({ projectId, name })),
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

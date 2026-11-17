"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import { ProviderId } from "@/domain/model-defaults";
import type { RanOn } from "@/domain/model-routing";
import { Hex, type Product } from "@/domain/product";
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
import { assertAllowedAssetUrl } from "@/providers/asset-bytes";
import type { ProductDraft } from "@/providers/text-prompts";
import { makerAction } from "@/server/guarded";
import {
  correctSample,
  readSample,
  type SampleCheck,
} from "@/server/material-photo";
import {
  ProductFileRefused,
  type StoredProductFile,
  storeProductPhoto,
  storeProductSvg,
} from "@/server/product-files";
import {
  blockedAsset,
  type ImportResult,
  importPackage,
  withOutline,
  withStoredImages,
} from "@/server/product-import";
import {
  deleteProduct,
  getProduct,
  type ImportedProduct,
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

export const listProductsAction = makerAction(
  async (_maker): Promise<Product[]> => {
    return listProducts();
  },
);

export type { ImportResult } from "@/server/product-import";

// Import a product package for the current maker (src/server/product-import.ts,
// the same import as POST /api/import): the valid products are saved, the
// others come back with their reasons.
export const importProductsAction = makerAction(
  async (_maker, input: unknown): Promise<ImportResult | { error: string }> => {
    return importPackage(input);
  },
);

const PHOTO_MIME = new Set<string>(ACCEPTED_IMAGE_MIME);

// The product form's file: a photo (PNG, JPEG, WebP) or the SVG of a design,
// stored with what the form can prefill (its colours; a design's proportions).
// FormData, because it carries a file; refusals come back as words.
export const uploadProductFileAction = makerAction(
  async (
    _maker,
    formData: FormData,
  ): Promise<StoredProductFile | { error: string }> => {
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
  },
);

const SampleUrl = z.string().min(1).max(4096);
const Fraction = z.number().min(0).max(1);
const SampleFix = z.union([
  z.object({ url: SampleUrl, white: z.object({ x: Fraction, y: Fraction }) }),
  z.object({ url: SampleUrl, swatch: Hex }),
]);

// A colour's material photo, checked against its swatch in the form: its main
// colour, then corrected on the maker's word (src/server/material-photo.ts),
// free. A corrected photo is a new stored file; the product changes on Save.
export const checkSampleAction = makerAction(
  async (_maker, input: unknown): Promise<SampleCheck> => {
    const parsed = z.object({ url: SampleUrl }).safeParse(input);
    if (!parsed.success) return { error: "No material photo to check." };
    return readSample(parsed.data.url);
  },
);

export const correctSampleAction = makerAction(
  async (_maker, input: unknown): Promise<SampleCheck> => {
    const parsed = SampleFix.safeParse(input);
    if (!parsed.success) return { error: "That correction could not be read." };
    const { url, ...how } = parsed.data;
    return correctSample(url, how);
  },
);

// Save the product the form describes, through the same checks as an import
// (its file where Kiln fetches, a design's outline measured against its size).
export const createProductAction = makerAction(
  async (
    _maker,
    input: unknown,
  ): Promise<
    | { product: Product; warning?: string }
    | { error: string; issues?: FormIssue[] }
  > => {
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
  },
);

const Draft = z.object({
  assetUrl: z.string().min(1),
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// "Fill from the photo": the product form drafted from the uploaded photo on
// the deep route (or the model the degraded notice offers), under the monthly
// cap. The photo must be in Kiln's storage.
export const draftProductAction = makerAction(
  async (
    _maker,
    input: unknown,
  ): Promise<{
    draft?: ProductDraft;
    degraded?: Degraded;
    ranOn?: RanOn;
    error?: string;
  }> => {
    const parsed = Draft.safeParse(input);
    if (!parsed.success) return { error: "Upload the photo first." };
    try {
      assertAllowedAssetUrl(parsed.data.assetUrl);
    } catch {
      return { error: "Upload the photo first." };
    }
    return draftProduct(parsed.data.assetUrl, parsed.data.model);
  },
);

const Review = z.object({
  form: ReviewForm,
  // The saved product being edited: its own limits apply.
  productId: z.string().min(1).optional(),
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// "Review with AI": the form as typed, saved or not, reviewed on the fast
// route (or by the model the degraded notice offers) under the cap. Returns
// the suggestions the form can take and the checks, with the name of the
// model that answered; nothing is saved.
export const reviewProductAction = makerAction(
  async (
    _maker,
    input: unknown,
  ): Promise<{
    review?: CleanReview & { model: string };
    degraded?: Degraded;
    ranOn?: RanOn;
    error?: string;
  }> => {
    const parsed = Review.safeParse(input);
    if (!parsed.success) return { error: "Nothing to review yet." };
    const { form, productId, model } = parsed.data;
    if (!form.name.trim() && !form.whatItIs.trim()) {
      return { error: "Name the product or say what it is first." };
    }
    const stored = productId ? await getProduct(productId) : null;
    const fields = reviewFields(
      form,
      stored ? editLimits(stored) : FORM_LIMITS,
    );
    const result = await reviewProduct(fields, model);
    if (!result.review) return { degraded: result.degraded };
    return {
      ...(result.ranOn ? { ranOn: result.ranOn } : {}),
      review: {
        ...cleanReview(result.review, fields),
        model: result.label ?? "",
      },
    };
  },
);

const Edit = z.object({ id: z.string().min(1), form: z.unknown() });

// Save an edited product over itself, through the same checks as a new one.
// Says what changed and which projects still follow an earlier version (each
// offers its update on its board). A product from a catalog connector is
// changed in the catalog, not here.
export const updateProductAction = makerAction(
  async (
    _maker,
    input: unknown,
  ): Promise<
    | {
        product: Product;
        status: ImportedProduct["status"];
        changed: string[];
        behind: { projectId: string; name: string }[];
        warning?: string;
      }
    | { error: string; issues?: FormIssue[] }
  > => {
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
  },
);

// Delete a product no project uses; otherwise say which projects do.
export const deleteProductAction = makerAction(
  async (
    _maker,
    input: unknown,
  ): Promise<
    | { deleted: true }
    | { error: string; usedBy?: { projectId: string; name: string }[] }
  > => {
    const id = z.string().min(1).parse(input);
    try {
      const result = await deleteProduct(id);
      if ("deleted" in result) return result;
      const names = result.usedBy.map((u) => u.name).join(", ");
      return {
        error: `Used by ${names}: delete ${result.usedBy.length === 1 ? "that project" : "those projects"} first.`,
        usedBy: result.usedBy.map(({ projectId, name }) => ({
          projectId,
          name,
        })),
      };
    } catch (error) {
      return { error: (error as Error).message };
    }
  },
);

import { z } from "zod";
import type { DraftFields } from "@/domain/etsy-draft";
import {
  type EtsyApp,
  type EtsyFetchOptions,
  type EtsyForm,
  EtsyListing,
  EtsyListingImage,
  EtsyMoney,
  etsyGet,
  etsySend,
} from "@/providers/shop/etsy";

// The draft listings of the maker's shop (ROADMAP Phase 11): read them, make
// one, change one (scope listings_w). Etsy has no drafts-only scope, so the
// rules are Kiln's: no request carries a listing's state (etsySend refuses
// it), no listing is ever deleted, and the server checks a listing is still a
// draft right before each change. Checked against Etsy's OpenAPI spec on
// 2026-11-02: listing writes take a form (a list as one comma-joined value),
// the inventory takes JSON, a photo goes as multipart.

const Id = z.number().int().positive();

export const EtsyDraftListing = EtsyListing.extend({
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  materials: z.array(z.string()).default([]),
  taxonomy_id: z.number().int().nullable().optional(),
  who_made: z.string().nullable().optional(),
  when_made: z.string().nullable().optional(),
  shipping_profile_id: Id.nullable().optional(),
  readiness_state_id: Id.nullable().optional(),
  has_variations: z.boolean().optional(),
  // Epoch seconds.
  updated_timestamp: z.number().int().optional(),
  images: z.array(EtsyListingImage).nullable().optional(),
});
export type EtsyDraftListing = z.infer<typeof EtsyDraftListing>;

const EtsyDraftListings = z.object({
  count: z.number().int().min(0),
  results: z.array(EtsyDraftListing),
});

export const EtsyOffering = z.object({
  offering_id: Id.optional(),
  quantity: z.number().int().min(0),
  is_enabled: z.boolean(),
  is_deleted: z.boolean().optional(),
  price: EtsyMoney,
  readiness_state_id: Id.nullable().optional(),
});

export const EtsyInventory = z.object({
  products: z.array(
    z.object({
      product_id: Id.optional(),
      sku: z.string().nullable().optional(),
      is_deleted: z.boolean().optional(),
      property_values: z.array(z.unknown()).default([]),
      offerings: z.array(EtsyOffering),
    }),
  ),
});
export type EtsyInventory = z.infer<typeof EtsyInventory>;

export interface TaxonomyNode {
  id: number;
  name: string;
  children: TaxonomyNode[];
}
const TaxonomyNodeSchema: z.ZodType<TaxonomyNode> = z.lazy(() =>
  z.object({
    id: Id,
    name: z.string(),
    children: z.array(TaxonomyNodeSchema).default([]),
  }),
);
const TaxonomyNodes = z.object({ results: z.array(TaxonomyNodeSchema) });

// A category the maker can pick, with the path down to it.
export interface TaxonomyChoice {
  id: number;
  name: string;
  path: string[];
}

export function flattenTaxonomy(nodes: TaxonomyNode[]): TaxonomyChoice[] {
  const out: TaxonomyChoice[] = [];
  const walk = (list: TaxonomyNode[], above: string[]) => {
    for (const node of list) {
      const path = [...above, node.name];
      out.push({ id: node.id, name: node.name, path });
      walk(node.children, path);
    }
  };
  walk(nodes, []);
  return out;
}

const ShippingProfiles = z.object({
  results: z.array(
    z.object({
      shipping_profile_id: Id,
      title: z.string().nullable().optional(),
      is_deleted: z.boolean().optional(),
    }),
  ),
});
const ProcessingProfiles = z.object({
  results: z.array(
    z.object({
      readiness_state_id: Id,
      readiness_state: z.string(),
      processing_days_display_label: z.string().optional(),
      min_processing_days: z.number().int().optional(),
      max_processing_days: z.number().int().optional(),
    }),
  ),
});

export interface ShopProfile {
  id: number;
  label: string;
}

export type DraftEdit = Partial<Omit<DraftFields, "price" | "quantity">>;

export interface DraftPhotoUpload {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  rank: number;
}

// The drafts of a shop, through the live API or the mock shop.
export interface EtsyDraftWriter {
  drafts(
    shopId: number,
    page: { limit: number; offset: number },
  ): Promise<{ count: number; results: EtsyDraftListing[] }>;
  // Any listing by id, with its photos and state (the check before a change).
  listing(listingId: number): Promise<EtsyDraftListing>;
  inventory(listingId: number): Promise<EtsyInventory>;
  taxonomy(): Promise<TaxonomyChoice[]>;
  shippingProfiles(shopId: number): Promise<ShopProfile[]>;
  processingProfiles(shopId: number): Promise<ShopProfile[]>;
  createDraft(shopId: number, fields: DraftFields): Promise<EtsyDraftListing>;
  updateDraft(
    shopId: number,
    listingId: number,
    edit: DraftEdit,
  ): Promise<EtsyDraftListing>;
  setInventory(listingId: number, body: InventoryBody): Promise<void>;
  addPhoto(
    shopId: number,
    listingId: number,
    photo: DraftPhotoUpload,
  ): Promise<z.infer<typeof EtsyListingImage>>;
  removePhoto(
    shopId: number,
    listingId: number,
    imageId: number,
  ): Promise<void>;
}

export interface InventoryBody {
  products: {
    sku: string;
    property_values: never[];
    offerings: {
      price: number;
      quantity: number;
      is_enabled: boolean;
      readiness_state_id: number | null;
    }[];
  }[];
}

// A draft's inventory with one price and quantity, kept from the one product
// it holds (its SKU and processing profile stay). Null when the draft has
// variations: rewriting it as one product would wipe them.
export function singleOffering(
  current: EtsyInventory,
  change: { price: number; quantity: number },
): InventoryBody | null {
  const products = current.products.filter((p) => !p.is_deleted);
  if (products.length > 1) return null;
  const product = products[0];
  const offering = product?.offerings.find((o) => !o.is_deleted);
  return {
    products: [
      {
        sku: product?.sku ?? "",
        property_values: [],
        offerings: [
          {
            price: change.price,
            quantity: change.quantity,
            is_enabled: true,
            readiness_state_id: offering?.readiness_state_id ?? null,
          },
        ],
      },
    ],
  };
}

export function draftForm(
  fields: DraftEdit & Partial<Pick<DraftFields, "price" | "quantity">>,
): EtsyForm {
  const list = (v: string[] | undefined) =>
    v === undefined ? undefined : v.map((w) => w.trim()).filter(Boolean);
  return {
    title: fields.title,
    description: fields.description,
    price: fields.price,
    quantity: fields.quantity,
    who_made: fields.whoMade,
    when_made: fields.whenMade,
    taxonomy_id: fields.taxonomyId,
    tags: list(fields.tags),
    materials: list(fields.materials),
    shipping_profile_id: fields.shippingProfileId,
    readiness_state_id: fields.readinessStateId,
  };
}

const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;
let taxonomyCache: { at: number; choices: TaxonomyChoice[] } | null = null;

export function etsyDrafts(
  app: EtsyApp,
  options: EtsyFetchOptions,
): EtsyDraftWriter {
  const get = <T>(
    path: string,
    query: Record<string, string | number | undefined>,
    schema: z.ZodType<T>,
  ) => etsyGet(app, path, query, schema, options);
  return {
    drafts: (shopId, { limit, offset }) =>
      get(
        `/shops/${shopId}/listings`,
        {
          state: "draft",
          includes: "Images",
          sort_on: "updated",
          sort_order: "desc",
          limit,
          offset,
        },
        EtsyDraftListings,
      ),
    listing: (listingId) =>
      get(`/listings/${listingId}`, { includes: "Images" }, EtsyDraftListing),
    inventory: (listingId) =>
      get(`/listings/${listingId}/inventory`, {}, EtsyInventory),
    taxonomy: async () => {
      if (taxonomyCache && Date.now() - taxonomyCache.at < TAXONOMY_TTL_MS) {
        return taxonomyCache.choices;
      }
      const nodes = await get("/seller-taxonomy/nodes", {}, TaxonomyNodes);
      const choices = flattenTaxonomy(nodes.results);
      taxonomyCache = { at: Date.now(), choices };
      return choices;
    },
    shippingProfiles: async (shopId) =>
      (
        await get(`/shops/${shopId}/shipping-profiles`, {}, ShippingProfiles)
      ).results
        .filter((p) => !p.is_deleted)
        .map((p) => ({
          id: p.shipping_profile_id,
          label: p.title?.trim() || `Profile ${p.shipping_profile_id}`,
        })),
    processingProfiles: async (shopId) =>
      (
        await get(
          `/shops/${shopId}/readiness-state-definitions`,
          {},
          ProcessingProfiles,
        )
      ).results.map((p) => ({
        id: p.readiness_state_id,
        label: [
          p.readiness_state === "ready_to_ship"
            ? "Ready to ship"
            : "Made to order",
          p.processing_days_display_label,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    createDraft: async (shopId, fields) =>
      (await etsySend(
        app,
        "POST",
        `/shops/${shopId}/listings`,
        {
          form: { ...draftForm(fields), type: "physical", is_supply: false },
        },
        EtsyDraftListing,
        options,
      )) as EtsyDraftListing,
    updateDraft: async (shopId, listingId, edit) =>
      (await etsySend(
        app,
        "PATCH",
        `/shops/${shopId}/listings/${listingId}`,
        { form: draftForm(edit) },
        EtsyDraftListing,
        options,
      )) as EtsyDraftListing,
    setInventory: async (listingId, body) => {
      await etsySend(
        app,
        "PUT",
        `/listings/${listingId}/inventory`,
        { json: { ...body } },
        null,
        options,
      );
    },
    addPhoto: async (shopId, listingId, photo) => {
      const form = new FormData();
      form.set(
        "image",
        new Blob([photo.bytes as BlobPart], { type: photo.mime }),
        photo.filename,
      );
      form.set("rank", String(photo.rank));
      return (await etsySend(
        app,
        "POST",
        `/shops/${shopId}/listings/${listingId}/images`,
        { multipart: form },
        EtsyListingImage,
        options,
      )) as z.infer<typeof EtsyListingImage>;
    },
    removePhoto: async (shopId, listingId, imageId) => {
      await etsySend(
        app,
        "DELETE",
        `/shops/${shopId}/listings/${listingId}/images/${imageId}`,
        undefined,
        null,
        options,
      );
    },
  };
}

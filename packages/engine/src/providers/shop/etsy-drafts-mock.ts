import type { DraftFields } from "@/domain/etsy-draft";
import { EtsyError, type EtsyListingImage } from "@/providers/shop/etsy";
import {
  type DraftEdit,
  type EtsyDraftListing,
  type EtsyDraftWriter,
  type EtsyInventory,
  flattenTaxonomy,
  type TaxonomyNode,
} from "@/providers/shop/etsy-drafts";
import {
  MOCK_SHOP_ID,
  mockListings,
  mockPhoto,
} from "@/providers/shop/etsy-mock";

// The mock shop's drafts (KILN_PROVIDERS=mock): kept in memory, so a draft
// Kiln makes is there on the next read. Like Etsy, the mock changes whatever
// it is asked to; keeping live listings out of reach is Kiln's guard, not the
// shop's. Two drafts start there, as if made in Etsy's editor: one plain, one
// with variations.

export const MOCK_TAXONOMY: TaxonomyNode[] = [
  {
    id: 891,
    name: "Home & Living",
    children: [
      {
        id: 1002,
        name: "Home Décor",
        children: [
          { id: 1029, name: "Wall Décor", children: [] },
          { id: 1031, name: "Door Décor", children: [] },
        ],
      },
      {
        id: 1050,
        name: "Kitchen & Dining",
        children: [{ id: 1063, name: "Coasters", children: [] }],
      },
    ],
  },
  {
    id: 2078,
    name: "Office & School",
    children: [{ id: 2093, name: "Desk Accessories", children: [] }],
  },
  {
    id: 1,
    name: "Bags & Purses",
    children: [{ id: 15, name: "Totes", children: [] }],
  },
];

interface MockDraft {
  listing: EtsyDraftListing;
  inventory: EtsyInventory;
}

export interface MockDraftStore {
  drafts: Map<number, MockDraft>;
  next: number;
}

const money = (value: number) => ({
  amount: Math.round(value * 100),
  divisor: 100,
  currency_code: "USD",
});

function seeded(): MockDraftStore {
  const at = Math.floor(Date.UTC(2026, 9, 20) / 1000);
  const plain = MOCK_SHOP_ID * 1000 + 501;
  const varied = MOCK_SHOP_ID * 1000 + 502;
  const image = (id: number, title: string) => ({
    listing_image_id: id * 10 + 1,
    rank: 1,
    url_75x75: mockPhoto(id, title),
    url_570xN: mockPhoto(id, title),
  });
  const offering = (price: number, quantity: number) => ({
    offering_id: 1,
    quantity,
    is_enabled: true,
    price: money(price),
    readiness_state_id: null,
  });
  const listing = (
    id: number,
    title: string,
    price: number,
    variations: boolean,
  ): EtsyDraftListing => ({
    listing_id: id,
    shop_id: MOCK_SHOP_ID,
    title,
    url: `https://www.etsy.com/listing/${id}`,
    state: "draft",
    num_favorers: 0,
    price: money(price),
    quantity: 5,
    description: `${title}, made by hand in the studio.`,
    tags: ["handmade gift"],
    materials: ["cotton"],
    taxonomy_id: variations ? 15 : 1029,
    who_made: "i_did",
    when_made: "made_to_order",
    has_variations: variations,
    updated_timestamp: at,
    images: [image(id, title)],
  });
  return {
    next: MOCK_SHOP_ID * 1000 + 600,
    drafts: new Map([
      [
        plain,
        {
          listing: listing(plain, "Hand-lettered Recipe Card", 18, false),
          inventory: {
            products: [
              { sku: "", property_values: [], offerings: [offering(18, 5)] },
            ],
          },
        },
      ],
      [
        varied,
        {
          listing: listing(varied, "Linen Tote, Three Colours", 32, true),
          inventory: {
            products: ["Natural", "Rust", "Sage"].map((colour, i) => ({
              product_id: i + 1,
              sku: `TOTE-${colour.toUpperCase()}`,
              property_values: [{ property_id: 200, values: [colour] }],
              offerings: [offering(32, 5)],
            })),
          },
        },
      ],
    ]),
  };
}

const GLOBAL = globalThis as { kilnMockEtsyDrafts?: MockDraftStore };

// The process's store (it outlives a dev server's module reloads).
export function mockDraftStore(): MockDraftStore {
  GLOBAL.kilnMockEtsyDrafts ??= seeded();
  return GLOBAL.kilnMockEtsyDrafts;
}

export const newMockDraftStore = seeded;

const dataUrl = (bytes: Uint8Array, mime: string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

export function mockEtsyDrafts(
  options: {
    store?: MockDraftStore;
    now?: () => Date;
    // Where a photo's bytes are kept; a data URL by default.
    keepPhoto?: (bytes: Uint8Array, mime: string) => Promise<string>;
  } = {},
): EtsyDraftWriter {
  const store = options.store ?? mockDraftStore();
  const now = options.now ?? (() => new Date());
  const keepPhoto =
    options.keepPhoto ?? (async (b: Uint8Array, m: string) => dataUrl(b, m));
  const found = (listingId: number) => {
    const draft = store.drafts.get(listingId);
    if (!draft) throw new EtsyError(404, `Listing ${listingId} not found.`);
    return draft;
  };
  const touch = (draft: MockDraft) => {
    draft.listing.updated_timestamp = Math.floor(now().getTime() / 1000);
  };
  const edited = (draft: MockDraft, edit: DraftEdit) => {
    const l = draft.listing;
    if (edit.title !== undefined) l.title = edit.title;
    if (edit.description !== undefined) l.description = edit.description;
    if (edit.tags !== undefined) l.tags = edit.tags;
    if (edit.materials !== undefined) l.materials = edit.materials;
    if (edit.taxonomyId !== undefined) l.taxonomy_id = edit.taxonomyId;
    if (edit.whoMade !== undefined) l.who_made = edit.whoMade;
    if (edit.whenMade !== undefined) l.when_made = edit.whenMade;
    if (edit.shippingProfileId !== undefined) {
      l.shipping_profile_id = edit.shippingProfileId;
    }
    if (edit.readinessStateId !== undefined) {
      l.readiness_state_id = edit.readinessStateId;
    }
    touch(draft);
  };
  return {
    drafts: async (shopId, { limit, offset }) => {
      const all = [...store.drafts.values()]
        .map((d) => d.listing)
        .filter((l) => l.shop_id === shopId && l.state === "draft")
        .sort(
          (a, b) => (b.updated_timestamp ?? 0) - (a.updated_timestamp ?? 0),
        );
      return { count: all.length, results: all.slice(offset, offset + limit) };
    },
    listing: async (listingId) => {
      const draft = store.drafts.get(listingId);
      if (draft) return structuredClone(draft.listing);
      const live = mockListings(MOCK_SHOP_ID).find(
        (l) => l.listing_id === listingId,
      );
      if (!live) throw new EtsyError(404, `Listing ${listingId} not found.`);
      return {
        ...live,
        description: "",
        tags: [],
        materials: [],
        images: [
          {
            rank: 1,
            url_75x75: mockPhoto(live.listing_id, live.title),
            url_570xN: mockPhoto(live.listing_id, live.title),
          },
        ],
      };
    },
    inventory: async (listingId) => structuredClone(found(listingId).inventory),
    taxonomy: async () => flattenTaxonomy(MOCK_TAXONOMY),
    shippingProfiles: async () => [{ id: 7001, label: "Standard shipping" }],
    processingProfiles: async () => [
      { id: 8001, label: "Made to order · 3-5 days" },
    ],
    createDraft: async (shopId, fields: DraftFields) => {
      const listingId = ++store.next;
      const draft: MockDraft = {
        listing: {
          listing_id: listingId,
          shop_id: shopId,
          title: fields.title,
          url: `https://www.etsy.com/listing/${listingId}`,
          state: "draft",
          num_favorers: 0,
          price: money(fields.price),
          quantity: fields.quantity,
          description: fields.description,
          tags: fields.tags,
          materials: fields.materials,
          taxonomy_id: fields.taxonomyId,
          who_made: fields.whoMade,
          when_made: fields.whenMade,
          shipping_profile_id: fields.shippingProfileId ?? null,
          readiness_state_id: fields.readinessStateId ?? null,
          has_variations: false,
          images: [],
        },
        inventory: {
          products: [
            {
              sku: "",
              property_values: [],
              offerings: [
                {
                  quantity: fields.quantity,
                  is_enabled: true,
                  price: money(fields.price),
                  readiness_state_id: fields.readinessStateId ?? null,
                },
              ],
            },
          ],
        },
      };
      touch(draft);
      store.drafts.set(listingId, draft);
      return structuredClone(draft.listing);
    },
    updateDraft: async (_shopId, listingId, edit) => {
      const draft = found(listingId);
      edited(draft, edit);
      return structuredClone(draft.listing);
    },
    setInventory: async (listingId, body) => {
      const draft = found(listingId);
      draft.inventory = {
        products: body.products.map((p) => ({
          sku: p.sku,
          property_values: [],
          offerings: p.offerings.map((o) => ({
            quantity: o.quantity,
            is_enabled: o.is_enabled,
            price: money(o.price),
            readiness_state_id: o.readiness_state_id,
          })),
        })),
      };
      const first = body.products[0]?.offerings[0];
      if (first) {
        draft.listing.price = money(first.price);
        draft.listing.quantity = first.quantity;
      }
      touch(draft);
    },
    addPhoto: async (_shopId, listingId, photo) => {
      const draft = found(listingId);
      const url = await keepPhoto(photo.bytes, photo.mime);
      const images = draft.listing.images ?? [];
      const image: EtsyListingImage = {
        listing_image_id: listingId * 100 + images.length + 1,
        rank: Math.min(photo.rank, images.length + 1),
        url_75x75: url,
        url_570xN: url,
        url_fullxfull: url,
      };
      draft.listing.images = [...images, image];
      touch(draft);
      return image;
    },
    removePhoto: async (_shopId, listingId, imageId) => {
      const draft = found(listingId);
      draft.listing.images = (draft.listing.images ?? [])
        .filter((i) => i.listing_image_id !== imageId)
        .map((i, n) => ({ ...i, rank: n + 1 }));
      touch(draft);
    },
  };
}

import { z } from "zod";
import type { DestinationText } from "@/domain/destination";
import {
  checkListing,
  type ListingText,
  listingVariations,
} from "@/domain/listing";
import type { Product } from "@/domain/product";

// An Etsy draft made from a product's listing kit (ROADMAP Phase 11, "Etsy
// drafts"): what Kiln sends to the maker's shop, before it is sent. A draft is
// never published by Kiln: the maker publishes it in Etsy's editor. The first
// slice sends the text, the photos, one price and a quantity; whatever the
// kit holds that is not sent yet is named, never dropped in silence.

export const WhoMade = z.enum(["i_did", "someone_else", "collective"]);
export type WhoMade = z.infer<typeof WhoMade>;

export const WhenMade = z.enum([
  "made_to_order",
  "2020_2026",
  "2010_2019",
  "2007_2009",
  "before_2007",
  "2000_2006",
  "1990s",
  "1980s",
  "1970s",
  "1960s",
  "1950s",
  "1940s",
  "1930s",
  "1920s",
  "1910s",
  "1900s",
  "1800s",
  "1700s",
  "before_1700",
]);
export type WhenMade = z.infer<typeof WhenMade>;

export const WHO_MADE_LABEL: Record<WhoMade, string> = {
  i_did: "I did",
  someone_else: "Someone else",
  collective: "A member of my shop",
};

export const whenMadeLabel = (when: WhenMade) =>
  when === "made_to_order"
    ? "Made to order"
    : when.startsWith("before_")
      ? `Before ${when.slice(7)}`
      : when.replace("_", "–");

// Etsy takes at most 20 photos on a listing.
export const ETSY_MAX_PHOTOS = 20;
export const ETSY_MAX_QUANTITY = 999;

// The draft's fields as Kiln sends them (never a state: setting one would
// publish the listing).
export interface DraftFields {
  title: string;
  description: string;
  price: number;
  quantity: number;
  whoMade: WhoMade;
  whenMade: WhenMade;
  taxonomyId: number;
  tags: string[];
  materials: string[];
  shippingProfileId?: number;
  readinessStateId?: number;
}

// The choices Etsy needs that the listing kit does not hold.
export const DraftSettings = z.object({
  taxonomyId: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(ETSY_MAX_QUANTITY).optional(),
  whoMade: WhoMade.default("i_did"),
  whenMade: WhenMade.default("made_to_order"),
  shippingProfileId: z.number().int().positive().optional(),
  readinessStateId: z.number().int().positive().optional(),
});
export type DraftSettings = z.infer<typeof DraftSettings>;

// The blockers the maker clears on the draft's own form.
export const NEEDS_CATEGORY = "Choose the Etsy category.";
export const NEEDS_QUANTITY = "Set the quantity.";

export interface DraftPhoto {
  file: string;
  slot: string;
  label: string;
  width: number;
  height: number;
}

export interface DraftProposal {
  // Null while a blocker stands.
  fields: DraftFields | null;
  photos: DraftPhoto[];
  blockers: string[];
  // What the kit holds that this draft does not carry yet.
  notSent: string[];
}

export function draftProposal(input: {
  product: Product;
  listing: ListingText;
  rules: DestinationText;
  photos: DraftPhoto[];
  settings: DraftSettings;
  hasVideo: boolean;
}): DraftProposal {
  const { product, listing, settings } = input;
  const blockers = checkListing(listing, product, input.rules)
    .filter((i) => i.severity === "error")
    .map((i) => i.message);
  if (input.photos.length === 0) {
    blockers.push("No photo is ready: approve the frames first.");
  }
  if (settings.taxonomyId === undefined) blockers.push(NEEDS_CATEGORY);
  if (settings.quantity === undefined) blockers.push(NEEDS_QUANTITY);
  for (const [field, words] of [
    ["tag", listing.tags.value],
    ["material", listing.materials.value],
  ] as const) {
    const comma = words.find((w) => w.includes(","));
    if (comma) {
      blockers.push(`The ${field} "${comma}" holds a comma: Etsy splits it.`);
    }
  }
  const photos = input.photos.slice(0, ETSY_MAX_PHOTOS);
  const notSent: string[] = [];
  if (input.photos.length > ETSY_MAX_PHOTOS) {
    notSent.push(
      `Photos after the ${ETSY_MAX_PHOTOS}th: Etsy takes ${ETSY_MAX_PHOTOS}.`,
    );
  }
  const variations = listingVariations(product);
  if (variations.length > 0) {
    notSent.push(
      `Variations (${variations.map((v) => v.name).join(", ")}): the draft carries one price; add them in Etsy's editor.`,
    );
  }
  if (listing.personalization.value.length > 0) {
    notSent.push("Personalization: set it in Etsy's editor.");
  }
  if (input.hasVideo) notSent.push("The video: upload it in Etsy's editor.");
  const ready =
    blockers.length === 0 &&
    product.price !== undefined &&
    settings.taxonomyId !== undefined &&
    settings.quantity !== undefined;
  return {
    fields: ready
      ? {
          title: listing.title.value.trim(),
          description: listing.description.value.trim(),
          price: product.price as number,
          quantity: settings.quantity as number,
          whoMade: settings.whoMade,
          whenMade: settings.whenMade,
          taxonomyId: settings.taxonomyId as number,
          tags: listing.tags.value,
          materials: listing.materials.value,
          ...(settings.shippingProfileId
            ? { shippingProfileId: settings.shippingProfileId }
            : {}),
          ...(settings.readinessStateId
            ? { readinessStateId: settings.readinessStateId }
            : {}),
        }
      : null,
    photos,
    blockers,
    notSent,
  };
}

// What changes on Etsy when a draft's fields are saved: each field whose
// value differs, before and after, in words.
export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export function draftChanges(
  before: Partial<Record<string, string | number | string[] | undefined>>,
  after: Partial<Record<string, string | number | string[] | undefined>>,
): FieldChange[] {
  const said = (v: string | number | string[] | undefined) =>
    v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);
  return Object.keys(after).flatMap((field) => {
    const was = said(before[field]);
    const now = said(after[field]);
    return after[field] === undefined || was === now
      ? []
      : [{ field, before: was, after: now }];
  });
}

// An Etsy price (amount over divisor) as a number in the shop's currency.
export const moneyValue = (m: { amount: number; divisor: number }) =>
  m.divisor > 0 ? m.amount / m.divisor : m.amount;

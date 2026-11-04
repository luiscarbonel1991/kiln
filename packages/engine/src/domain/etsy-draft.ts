import { z } from "zod";
import type { DestinationText } from "@/domain/destination";
import {
  checkListing,
  type ListingText,
  listingVariations,
} from "@/domain/listing";
import type { Product } from "@/domain/product";

// An Etsy draft made from a product's listing kit: what Kiln sends to the
// maker's shop, before it is sent. A draft is never published by Kiln: the
// maker publishes it in Etsy's editor. The first slice sends the text, the
// photos, one price and a quantity; whatever the kit holds that is not sent yet
// is named, never dropped in silence.

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
  shippingProfileId: number;
  readinessStateId: number;
  // With a calculated shipping profile: the item as shipped, packaging in.
  weight?: ItemWeight;
  size?: ItemSize;
}

export const WeightUnit = z.enum(["oz", "lb", "g", "kg"]);
export const SizeUnit = z.enum(["in", "ft", "mm", "cm", "m", "yd"]);
export const ItemWeight = z.object({
  value: z.number().positive().max(10_000),
  unit: WeightUnit,
});
export type ItemWeight = z.infer<typeof ItemWeight>;
export const ItemSize = z.object({
  length: z.number().positive().max(10_000),
  width: z.number().positive().max(10_000),
  height: z.number().positive().max(10_000),
  unit: SizeUnit,
});
export type ItemSize = z.infer<typeof ItemSize>;

// The choices Etsy needs that the listing kit does not hold.
export const DraftSettings = z.object({
  taxonomyId: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(ETSY_MAX_QUANTITY).optional(),
  whoMade: WhoMade.default("i_did"),
  whenMade: WhenMade.default("made_to_order"),
  shippingProfileId: z.number().int().positive().optional(),
  readinessStateId: z.number().int().positive().optional(),
  weight: ItemWeight.optional(),
  size: ItemSize.optional(),
});
export type DraftSettings = z.infer<typeof DraftSettings>;

// The blockers the maker clears on the draft's own form.
export const NEEDS_CATEGORY = "Choose the Etsy category.";
export const NEEDS_QUANTITY = "Set the quantity.";
// Etsy refuses a physical listing, a draft too, without a processing profile
// (2026-11-02, the first real draft: "A readiness_state_id is required for
// physical listings").
export const NEEDS_PROCESSING =
  "Choose the processing profile: Etsy needs one for a physical item.";
// And a shipping profile; a calculated one prices by the item's weight and
// size, which Etsy then needs on the listing (2026-11-02).
export const NEEDS_SHIPPING =
  "Choose the shipping profile: Etsy needs one for a physical item.";
export const NEEDS_WEIGHT_SIZE =
  "Add the item's weight and packed size: the shipping profile is calculated from them.";

// The blockers the draft's form settles, from its settings alone.
export function settingsBlockers(
  settings: DraftSettings,
  calculated: (shippingProfileId: number) => boolean,
): string[] {
  const out: string[] = [];
  if (settings.taxonomyId === undefined) out.push(NEEDS_CATEGORY);
  if (settings.quantity === undefined) out.push(NEEDS_QUANTITY);
  if (settings.shippingProfileId === undefined) out.push(NEEDS_SHIPPING);
  else if (
    calculated(settings.shippingProfileId) &&
    (!settings.weight || !settings.size)
  ) {
    out.push(NEEDS_WEIGHT_SIZE);
  }
  if (settings.readinessStateId === undefined) out.push(NEEDS_PROCESSING);
  return out;
}

export const SETTINGS_BLOCKERS = [
  NEEDS_CATEGORY,
  NEEDS_QUANTITY,
  NEEDS_SHIPPING,
  NEEDS_WEIGHT_SIZE,
  NEEDS_PROCESSING,
];

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
  // Whether a shipping profile prices by weight and size.
  calculated?: (shippingProfileId: number) => boolean;
}): DraftProposal {
  const { product, listing, settings } = input;
  const blockers = checkListing(listing, product, input.rules)
    .filter((i) => i.severity === "error")
    .map((i) => i.message);
  if (input.photos.length === 0) {
    blockers.push("No photo is ready: approve the frames first.");
  }
  const calculated = input.calculated ?? (() => false);
  blockers.push(...settingsBlockers(settings, calculated));
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
    settings.quantity !== undefined &&
    settings.shippingProfileId !== undefined &&
    settings.readinessStateId !== undefined;
  const shipped =
    ready && calculated(settings.shippingProfileId as number)
      ? { weight: settings.weight, size: settings.size }
      : {};
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
          shippingProfileId: settings.shippingProfileId as number,
          readinessStateId: settings.readinessStateId as number,
          ...shipped,
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

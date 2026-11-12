import { TREATMENT_LABEL } from "@/domain/exact";
import { listingDraft } from "@/domain/listing";
import type { PlanDestination } from "@/domain/plan";
import { buyerSizeLabel, type Product } from "@/domain/product";
import { CATALOG } from "@/lib/recipes";

// A product told to a reader: its facts as a buyer reads them, and its
// listing's words on a channel. Pure, and free of the database, so the public
// page tells its sample kit with it (site-kit.ts).

export interface StoryProduct {
  name: string;
  sku: string;
  size: string;
  material: string;
  finish: string;
  colours: { key: string; name: string; face: string; inStock: boolean }[];
  wording: { label: string; example?: string }[];
  price?: number;
  hook?: string;
}

export interface StoryWords {
  channel: string;
  title: string;
  titleMax: number;
  description: string;
  tags: string[];
  tagMax: number;
}

const destinationOf = (id: string) =>
  CATALOG.destinations.find((d) => d.id === id);

export function storyProduct(product: Product): StoryProduct {
  return {
    name: product.name,
    sku: product.sku,
    size: buyerSizeLabel(product),
    material: product.material,
    finish: TREATMENT_LABEL[product.treatment],
    colours: product.colours.map((c) => ({
      key: c.key,
      name: c.name,
      face: c.face,
      inStock: c.inStock,
    })),
    wording: product.wording.map((w) => ({
      label: w.label,
      ...(w.example ? { example: w.example } : {}),
    })),
    ...(product.price !== undefined ? { price: product.price } : {}),
    ...(product.hook ? { hook: product.hook } : {}),
  };
}

// The listing's words on a destination that takes text: its saved listing,
// else the free draft from the spec, the description cut to two paragraphs.
// Without a destination, the first channel that takes text.
export function storyWords(
  product: Product,
  destination: PlanDestination | undefined,
): StoryWords | null {
  const profile =
    (destination && destinationOf(destination.destinationId)?.text
      ? destinationOf(destination.destinationId)
      : undefined) ?? CATALOG.destinations.find((d) => d.text);
  if (!profile?.text) return null;
  const listing =
    (destination?.destinationId === profile.id
      ? destination.listing
      : undefined) ?? listingDraft(product, profile.text);
  const description = listing.description.value
    .split(/\n\s*\n/)
    .slice(0, 2)
    .join("\n\n")
    .trim();
  return {
    channel: profile.name,
    title: listing.title.value.trim(),
    titleMax: profile.text.title.maxChars,
    description,
    tags: listing.tags.value,
    tagMax: profile.text.tags.count,
  };
}

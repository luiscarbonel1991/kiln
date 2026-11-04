import { z } from "zod";

// Where a deliverable lands: a sale destination (Etsy, Shopify, the maker's
// website) or a content destination (Instagram, Pinterest). A profile is data,
// not code: formats with pixel targets, the rules an output must follow, and
// how it is delivered. A human always publishes.
export const DestinationKind = z.enum(["sale", "content"]);
export type DestinationKind = z.infer<typeof DestinationKind>;

export const Aspect = z.string().regex(/^\d+:\d+$/, "aspect like 4:5");

export const DestinationFormat = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  aspect: Aspect,
  minPx: z.number().int().positive().optional(),
});
export type DestinationFormat = z.infer<typeof DestinationFormat>;

// `textOnImage` is the default text policy for the destination's scene slots
// (Etsy hero: forbidden; a carousel slide: expected). Text is always drawn by a
// template, never by the image model. `negative` lists what must never appear.
export const DestinationRules = z.object({
  textOnImage: z.enum(["forbidden", "allowed", "expected"]),
  negative: z.array(z.string()).default([]),
});
export type DestinationRules = z.infer<typeof DestinationRules>;

// "draft-api" = a draft pushed through the destination's API; "export" = a
// folder the maker posts by hand.
export const Delivery = z.object({
  mode: z.enum(["export", "draft-api"]),
});

// The listing video a destination takes, when it takes one (Etsy: 5-15 s).
export const DestinationVideo = z.object({
  minSec: z.number().positive(),
  maxSec: z.number().positive(),
});

// What a listing's text must meet on a sale destination (data, not code):
// each limit is one the channel refuses (checkListing reports an error) or,
// where marked, advises (a warning). Where each comes from is noted with the
// destination's data.
export const DestinationText = z.object({
  title: z.object({
    maxChars: z.number().int().positive(),
    // Advice, not a refusal: a short title that names the item once.
    adviseMaxWords: z.number().int().positive().optional(),
  }),
  tags: z.object({
    count: z.number().int().positive(),
    maxChars: z.number().int().positive(),
    // The characters a tag may hold, as a Unicode regex.
    pattern: z.string().min(1),
  }),
  personalization: z.object({
    maxFields: z.number().int().positive(),
    titleMaxChars: z.number().int().positive(),
    instructionsMaxChars: z.number().int().positive(),
    // Words in capitals an instruction may hold ("UNIT, SUITE" is two).
    maxCapsWords: z.number().int().nonnegative(),
  }),
  variations: z.object({ maxTypes: z.number().int().positive() }),
});
export type DestinationText = z.infer<typeof DestinationText>;

export const DestinationProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: DestinationKind,
  formats: z.array(DestinationFormat).min(1),
  rules: DestinationRules,
  delivery: Delivery,
  video: DestinationVideo.optional(),
  text: DestinationText.optional(),
});
export type DestinationProfile = z.infer<typeof DestinationProfile>;

import { z } from "zod";
import { Aspect } from "@/domain/destination";

// A live listing: a listing already selling, whose photos the maker refreshes.
// Its address is kept, so the plan says what it refreshes and the results loop
// can read its numbers later; Kiln never opens the page. Its photos come from
// the maker (uploaded), never fetched.

// Etsy shows up to 20 photos on a listing.
export const MAX_LIVE_PHOTOS = 20;

export const ListingUrl = z
  .url({ protocol: /^https$/, error: "Paste the listing's https address." })
  .max(500);

// One of the listing's photos as it shows now, in its order: kept, or
// replaced by one of the shot list's frames (its key).
export const LivePhoto = z.object({
  url: z.string().min(1),
  // The photo's own proportions, as uploaded (a kept photo is never cropped).
  aspect: Aspect,
  replaceWith: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});
export type LivePhoto = z.infer<typeof LivePhoto>;

// "https://www.etsy.com/listing/4413933723/door-number" -> "4413933723": the
// id Etsy's API knows the listing by. Null for any other address.
export function etsyListingId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "etsy.com" && !host.endsWith(".etsy.com")) return null;
  return parsed.pathname.match(/\/listing\/(\d+)(?:\/|$)/)?.[1] ?? null;
}

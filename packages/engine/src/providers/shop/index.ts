import { createHash } from "node:crypto";
import { daysIn, type Metric } from "@/domain/listing-results";
import { etsyListingId } from "@/domain/live-listing";
import { mockDelay, providerMode } from "@/providers/mode";

// A shop connector (ROADMAP Phase 20, "The Etsy connection"): a sale
// destination's own numbers for one of the maker's listings, read through the
// shop's API, never its pages. Beside the typed and API paths, so nothing
// waits on keys: a mock run reads a mock shop, and the Etsy connector comes
// with its OAuth keys.

export type ShopNumbers = Partial<Record<Metric, number>>;

export interface ShopConnector {
  // Named as the read's source.
  readonly label: string;
  // The listing's numbers over a window, both days included, as far as the
  // shop gives them.
  readListing(
    listingUrl: string,
    window: { from: string; to: string },
  ): Promise<ShopNumbers>;
}

// Deterministic numbers per listing and window: a listing keeps its traffic,
// each window wanders around it.
export const mockShop: ShopConnector = {
  label: "Mock shop",
  async readListing(listingUrl, window) {
    await mockDelay();
    const id = etsyListingId(listingUrl) ?? listingUrl;
    const unit = (salt: string) =>
      createHash("sha256").update(`${id}|${salt}`).digest().readUInt32BE(0) /
      0xffffffff;
    const span = `${window.from}|${window.to}`;
    const perDay = 0.5 + unit("traffic") * 6;
    const visits = Math.round(
      perDay * daysIn(window) * (0.7 + unit(span) * 0.6),
    );
    const orders = Math.round(visits * (0.01 + unit(`${span}|o`) * 0.06));
    return {
      visits,
      views: Math.round(visits * (1.4 + unit(`${span}|v`))),
      favourites: Math.round(visits * unit(`${span}|f`) * 0.12),
      orders,
      revenue: Math.round(orders * (12 + unit("price") * 40) * 100) / 100,
      searchVisits: Math.round(visits * (0.15 + unit(`${span}|s`) * 0.3)),
    };
  },
};

// The connector for a sale destination, or null: typed numbers and the API
// still work without one.
export function shopConnector(): ShopConnector | null {
  return providerMode() === "mock" ? mockShop : null;
}

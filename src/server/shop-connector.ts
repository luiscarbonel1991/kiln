import { etsyListingId } from "@/domain/live-listing";
import { bestSellers } from "@/domain/shop-ranking";
import { providerMode } from "@/providers/mode";
import { mockShop, type ShopConnector } from "@/providers/shop";
import { allPages, type EtsyReceipt } from "@/providers/shop/etsy";
import { connectedEtsy, shopConnection } from "@/server/shop-connection";

// The shop connector the results loop reads from (ROADMAP Phase 20): the mock
// shop in a mock run; else the maker's connected Etsy shop, whose API gives a
// listing's orders and revenue in a window (from its receipts) but not its
// visits or views, which still come from the shop's stats; else none.

const DAY_SEC = 86_400;
const MAX_RECEIPT_PAGES = 50;

export const ETSY_CONNECTOR_LABEL = "Etsy";

export async function resultsConnector(): Promise<ShopConnector | null> {
  if (providerMode() === "mock") return mockShop;
  const connection = await shopConnection();
  if (!connection || connection.needsReconnect) return null;
  return {
    label: ETSY_CONNECTOR_LABEL,
    async readListing(listingUrl, window) {
      const listingId = etsyListingId(listingUrl);
      if (!listingId) {
        throw new Error("Not an Etsy listing address: Etsy cannot read it.");
      }
      const etsy = await connectedEtsy();
      if (!etsy) throw new Error("No Etsy shop is connected.");
      // The window's days, whole, in UTC.
      const minCreated = Date.parse(`${window.from}T00:00:00Z`) / 1000;
      const maxCreated =
        Date.parse(`${window.to}T00:00:00Z`) / 1000 + DAY_SEC - 1;
      const { items } = await allPages<EtsyReceipt>(
        (page) =>
          etsy.reader.receipts(etsy.shopId, {
            minCreated,
            maxCreated,
            ...page,
          }),
        MAX_RECEIPT_PAGES,
      );
      const sold = bestSellers(items).find((r) => r.listingId === listingId);
      return { orders: sold?.orders ?? 0, revenue: sold?.revenue ?? 0 };
    },
  };
}

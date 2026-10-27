import { createHash } from "node:crypto";
import {
  EtsyError,
  type EtsyListing,
  type EtsyReader,
  type EtsyReceipt,
  type EtsyShop,
} from "@/providers/shop/etsy";

// The Etsy a mock run reads (KILN_PROVIDERS=mock): a connected shop with a
// year of orders, and a few other shops to look up by name. Deterministic per
// day, so a ranking reads the same twice; nothing is called.

export const MOCK_USER_ID = 90001;
export const MOCK_SHOP_ID = 50001;

const SHOPS: { id: number; name: string; openedYearsAgo: number }[] = [
  { id: MOCK_SHOP_ID, name: "MockMakerStudio", openedYearsAgo: 3 },
  { id: 60011, name: "NorthPineGoods", openedYearsAgo: 6 },
  { id: 60012, name: "CopperFernCo", openedYearsAgo: 2 },
  { id: 60013, name: "HarborLinenHouse", openedYearsAgo: 9 },
  { id: 60014, name: "WillowAndWax", openedYearsAgo: 4 },
  { id: 60015, name: "PineAndPaperStudio", openedYearsAgo: 1 },
];

const THINGS = [
  "Walnut Coaster Set",
  "Linen Table Runner",
  "Stoneware Mug",
  "Leather Keychain",
  "Desk Name Plate",
  "Oak Serving Board",
  "Soy Candle",
  "Brass Bookmark",
  "Wool Throw Pillow",
  "Cork Trivet",
  "Maple Phone Stand",
  "Ceramic Planter",
];
const STYLES = ["Personalized", "Minimal", "Rustic", "Modern", "Handmade"];

const DAY = 86_400;

const unit = (salt: string) =>
  createHash("sha256").update(salt).digest().readUInt32BE(0) / 0xffffffff;

function mockShop(id: number, nowSec: number): EtsyShop {
  const shop = SHOPS.find((s) => s.id === id);
  if (!shop) throw new EtsyError(404, "Shop not found");
  const sold = Math.round(
    shop.openedYearsAgo * (300 + unit(`${id}|sold`) * 4000),
  );
  return {
    shop_id: id,
    shop_name: shop.name,
    url: `https://www.etsy.com/shop/${shop.name}`,
    create_date: nowSec - Math.round(shop.openedYearsAgo * 365.25 * DAY),
    currency_code: "USD",
    transaction_sold_count: sold,
    num_favorers: Math.round(sold * (0.2 + unit(`${id}|fav`) * 0.5)),
    review_count: Math.round(sold * 0.04),
    review_average: Math.round((4.5 + unit(`${id}|rev`) * 0.5) * 100) / 100,
    listing_active_count: 24,
    is_vacation: false,
  };
}

function mockListings(shopId: number): EtsyListing[] {
  return Array.from({ length: 24 }, (_, i) => {
    const thing = THINGS[(i + shopId) % THINGS.length];
    const style = STYLES[Math.floor(unit(`${shopId}|${i}|s`) * STYLES.length)];
    const listingId = shopId * 1000 + i + 1;
    return {
      listing_id: listingId,
      shop_id: shopId,
      title: `${style} ${thing} &amp; Gift Box`,
      url: `https://www.etsy.com/listing/${listingId}/${style.toLowerCase()}-${thing.toLowerCase().replace(/\s+/g, "-")}`,
      state: "active",
      num_favorers: Math.round(unit(`${shopId}|${i}|f`) ** 2 * 2400),
      price: {
        amount: 1200 + Math.round(unit(`${shopId}|${i}|p`) * 60) * 100,
        divisor: 100,
        currency_code: "USD",
      },
      quantity: 10,
    };
  });
}

// The connected shop's orders: a day has up to three, each one or two
// listings, the popular ones more often; one order in twenty is canceled.
function mockReceipts(nowSec: number): EtsyReceipt[] {
  const listings = mockListings(MOCK_SHOP_ID);
  const today = Math.floor(nowSec / DAY) * DAY;
  const receipts: EtsyReceipt[] = [];
  for (let d = 0; d < 400; d++) {
    const day = today - d * DAY;
    const orders = Math.floor(unit(`${day}|n`) * 4);
    for (let o = 0; o < orders; o++) {
      const at = day + Math.floor(unit(`${day}|${o}|t`) * (DAY - 1));
      if (at > nowSec) continue;
      const lines = unit(`${day}|${o}|l`) < 0.25 ? 2 : 1;
      receipts.push({
        receipt_id: day / 10 + o + 1,
        status:
          unit(`${day}|${o}|c`) < 0.05
            ? "Canceled"
            : d < 5
              ? "Paid"
              : "Completed",
        created_timestamp: at,
        transactions: Array.from({ length: lines }, (_, l) => {
          const pick = listings[
            Math.floor(unit(`${day}|${o}|${l}|p`) ** 2 * listings.length)
          ] as EtsyListing;
          return {
            transaction_id: (day / 10 + o + 1) * 10 + l,
            listing_id: pick.listing_id,
            title: pick.title,
            quantity: unit(`${day}|${o}|${l}|q`) < 0.8 ? 1 : 2,
            price: pick.price,
          };
        }),
      });
    }
  }
  return receipts.sort((a, b) => b.created_timestamp - a.created_timestamp);
}

export function mockEtsy(now: () => Date = () => new Date()): EtsyReader {
  const nowSec = () => Math.floor(now().getTime() / 1000);
  return {
    me: async () => ({ user_id: MOCK_USER_ID, shop_id: MOCK_SHOP_ID }),
    shop: async (shopId) => mockShop(shopId, nowSec()),
    findShops: async (name) => {
      const wanted = name.trim().toLowerCase();
      return wanted
        ? SHOPS.filter((s) => s.name.toLowerCase().includes(wanted)).map((s) =>
            mockShop(s.id, nowSec()),
          )
        : [];
    },
    activeListings: async (shopId, { limit, offset }) => {
      mockShop(shopId, nowSec());
      const all = mockListings(shopId);
      return { count: all.length, results: all.slice(offset, offset + limit) };
    },
    receipts: async (shopId, { minCreated, maxCreated, limit, offset }) => {
      if (shopId !== MOCK_SHOP_ID) {
        throw new EtsyError(403, "Forbidden");
      }
      const all = mockReceipts(nowSec()).filter(
        (r) =>
          r.created_timestamp >= minCreated &&
          (maxCreated === undefined || r.created_timestamp <= maxCreated),
      );
      return { count: all.length, results: all.slice(offset, offset + limit) };
    },
  };
}

import type { EtsyReader } from "@/providers/shop/etsy";

// A fetch that answers Etsy's API from an EtsyReader (the mock shop), in
// Etsy's shapes, and its OAuth token endpoint from a queue of answers: the
// live code paths run end to end with no network. Every request is kept.
export function etsyFetch(
  reader: EtsyReader,
  tokens: { status?: number; body: unknown }[] = [],
) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });
  const fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/v3/public/oauth/token") {
      const next = tokens.shift();
      return next
        ? answer(next.status ?? 200, next.body)
        : answer(500, { error: "no token answer queued" });
    }
    const path = url.pathname.replace("/v3/application", "");
    const q = url.searchParams;
    const page = {
      limit: Number(q.get("limit") ?? 25),
      offset: Number(q.get("offset") ?? 0),
    };
    try {
      if (path === "/users/me") return answer(200, await reader.me());
      if (path === "/shops") {
        const results = await reader.findShops(q.get("shop_name") ?? "");
        return answer(200, { count: results.length, results });
      }
      const receipts = path.match(/^\/shops\/(\d+)\/receipts$/);
      if (receipts) {
        return answer(
          200,
          await reader.receipts(Number(receipts[1]), {
            minCreated: Number(q.get("min_created") ?? 0),
            maxCreated: q.get("max_created")
              ? Number(q.get("max_created"))
              : undefined,
            ...page,
          }),
        );
      }
      if (path === "/listings/batch") {
        const ids = (q.get("listing_ids") ?? "")
          .split(",")
          .filter(Boolean)
          .map(Number);
        const results = await reader.listings(ids);
        return answer(200, { count: results.length, results });
      }
      const listings = path.match(/^\/shops\/(\d+)\/listings\/active$/);
      if (listings) {
        return answer(
          200,
          await reader.activeListings(Number(listings[1]), page),
        );
      }
      const shop = path.match(/^\/shops\/(\d+)$/);
      if (shop) return answer(200, await reader.shop(Number(shop[1])));
      return answer(404, { error: `No route ${path}` });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return answer(status, { error: (error as Error).message });
    }
  };
  return { fetch, calls };
}

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { etsyFetch } from "@/server/__fixtures__/etsy-fetch";

// The Etsy connection and Shops against a migrated throwaway Postgres (see
// project-repository.db.test.ts), on the live code paths: the app's Etsy keys
// are set for the test, and fetch answers from the mock shop in Etsy's shapes,
// so nothing leaves the machine.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

const REDIRECT = "https://localhost:3009/api/shops/etsy/callback";
vi.mock("@/lib/env", async (original) => {
  const real = await original<typeof import("@/lib/env")>();
  return {
    env: {
      ...real.env,
      ETSY_API_KEY: "kstr",
      ETSY_SHARED_SECRET: "shh",
      ETSY_REDIRECT_URI: REDIRECT,
    },
  };
});

describe.skipIf(!enabled)("Etsy connection and Shops (database)", async () => {
  const { db } = await import("@/lib/db");
  const shops = await import("@/server/shop-connection");
  const ranking = await import("@/server/shop-ranking");
  const { getCurrentMaker, watchShop, unwatchShop } = await import(
    "@/server/maker-repository"
  );
  const { mockEtsy, MOCK_SHOP_ID } = await import("@/providers/shop/etsy-mock");
  const { unseal } = await import("@/server/secret-box");

  const NOW = new Date("2026-10-27T12:00:00Z");
  const tokenAnswer = (n: number) => ({
    body: {
      access_token: `90001.access-${n}`,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: `90001.refresh-${n}`,
    },
  });

  beforeEach(async () => {
    await shops.disconnectShop();
    ranking.forgetShopReads();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await shops.disconnectShop();
    await unwatchShop("60011");
    await unwatchShop("60013");
  });

  // Connect through the real handshake: the URL Etsy is sent, the cookie,
  // and the callback's code.
  async function connect(answers = [tokenAnswer(1)]) {
    const etsy = etsyFetch(
      mockEtsy(() => NOW),
      answers,
    );
    vi.stubGlobal("fetch", etsy.fetch);
    const { url, cookie } = shops.beginConnect(NOW.getTime());
    const state = new URL(url).searchParams.get("state");
    const view = await shops.finishConnect({
      code: "the-code",
      state,
      cookie,
      now: NOW.getTime(),
    });
    return { view, etsy, url: new URL(url) };
  }

  it("sends the maker to Etsy with PKCE, then keeps the shop with its tokens sealed", async () => {
    const { view, etsy, url } = await connect();
    expect(url.origin + url.pathname).toBe(
      "https://www.etsy.com/oauth/connect",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(view).toMatchObject({
      platform: "etsy",
      shopId: String(MOCK_SHOP_ID),
      shopName: "MockMakerStudio",
      needsReconnect: false,
    });
    // The code was traded with the verifier whose challenge Etsy was shown.
    const trade = new URLSearchParams(String(etsy.calls[0].init?.body));
    expect(trade.get("code")).toBe("the-code");
    expect(trade.get("redirect_uri")).toBe(REDIRECT);
    const { pkceChallenge } = await import("@/providers/shop/etsy-oauth");
    expect(pkceChallenge(trade.get("code_verifier") ?? "")).toBe(
      url.searchParams.get("code_challenge"),
    );
    // The shop was read with the new token and the app's identity.
    expect(etsy.calls[1].url.pathname).toBe("/v3/application/users/me");
    expect(etsy.calls[1].init?.headers).toMatchObject({
      "x-api-key": "kstr:shh",
      authorization: "Bearer 90001.access-1",
    });
    const maker = await getCurrentMaker();
    const row = await db.shopConnection.findUniqueOrThrow({
      where: { makerId_platform: { makerId: maker.id, platform: "etsy" } },
    });
    expect(row.accessToken).not.toContain("access-1");
    expect(row.refreshToken).not.toContain("refresh-1");
    expect(unseal(row.accessToken, "etsy-access")).toBe("90001.access-1");
    expect(row.scopes).toBe("shops_r listings_r transactions_r");
    expect(await shops.shopConnection()).toEqual(view);
  });

  it("refuses an answer that is not the connection Kiln started", async () => {
    const { url, cookie } = shops.beginConnect();
    const state = new URL(url).searchParams.get("state");
    await expect(
      shops.finishConnect({ code: "c", state: "forged", cookie }),
    ).rejects.toMatchObject({ problem: "state" });
    await expect(
      shops.finishConnect({ code: "c", state, cookie: undefined }),
    ).rejects.toMatchObject({ problem: "expired" });
    await expect(
      shops.finishConnect({
        code: "c",
        state,
        cookie,
        now: Date.now() + 11 * 60_000,
      }),
    ).rejects.toMatchObject({ problem: "expired" });
    await expect(
      shops.finishConnect({
        code: null,
        state,
        cookie,
        error: "access_denied",
      }),
    ).rejects.toMatchObject({ problem: "denied" });
    expect(await shops.shopConnection()).toBeNull();
  });

  it("refreshes an access token about to expire, once for requests that come together", async () => {
    await connect([tokenAnswer(1)]);
    const later = new Date(NOW.getTime() + 59 * 60_000);
    const etsy = etsyFetch(
      mockEtsy(() => later),
      [tokenAnswer(2)],
    );
    const [a, b] = await Promise.all([
      shops.connectedEtsy({ now: later, fetch: etsy.fetch }),
      shops.connectedEtsy({ now: later, fetch: etsy.fetch }),
    ]);
    const refreshes = etsy.calls.filter(
      (c) => c.url.pathname === "/v3/public/oauth/token",
    );
    expect(refreshes).toHaveLength(1);
    expect(
      Object.fromEntries(new URLSearchParams(String(refreshes[0].init?.body))),
    ).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "90001.refresh-1",
    });
    await a?.reader.me();
    await b?.reader.me();
    const reads = etsy.calls.filter((c) =>
      c.url.pathname.endsWith("/users/me"),
    );
    expect(
      reads.map(
        (c) => (c.init?.headers as Record<string, string>).authorization,
      ),
    ).toEqual(["Bearer 90001.access-2", "Bearer 90001.access-2"]);
  });

  it("a refresh Etsy refuses asks the maker to connect again", async () => {
    await connect([tokenAnswer(1)]);
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    const etsy = etsyFetch(
      mockEtsy(() => later),
      [{ status: 400, body: { error: "invalid_grant" } }],
    );
    await expect(
      shops.connectedEtsy({ now: later, fetch: etsy.fetch }),
    ).rejects.toThrow("connect it again");
    expect(await shops.shopConnection()).toMatchObject({
      needsReconnect: true,
    });
    // Connecting again clears it.
    await connect([tokenAnswer(3)]);
    expect(await shops.shopConnection()).toMatchObject({
      needsReconnect: false,
    });
  });

  it("best sellers: the shop's listings by units sold in the window, each with its Kiln project", async () => {
    await connect();
    vi.stubGlobal("fetch", etsyFetch(mockEtsy(() => NOW)).fetch);
    const view = await ranking.yourBestSellers(90, { now: NOW });
    expect(view).toMatchObject({
      shopName: "MockMakerStudio",
      window: 90,
      from: "2026-07-29",
      complete: true,
    });
    expect(view?.orders).toBeGreaterThan(50);
    const rows = view?.rows ?? [];
    expect(rows.length).toBeGreaterThan(3);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].units).toBeGreaterThanOrEqual(rows[i].units);
    }
    expect(rows[0].url).toBe(
      `https://www.etsy.com/listing/${rows[0].listingId}`,
    );
    expect(rows[0].title).not.toContain("&amp;");
    // A listing a Kiln project refreshes names that project.
    const maker = await getCurrentMaker();
    const project = await db.project.create({
      data: {
        makerId: maker.id,
        name: "Best seller refresh",
        type: "listing-kit",
        phase: "plan",
        plan: {
          destinations: [
            {
              destinationId: "etsy",
              shotListId: "etsy-listing",
              slots: [
                { key: "hero", label: "Hero", purpose: "Hero", fill: "scene" },
              ],
              listingUrl: `https://www.etsy.com/listing/${rows[1].listingId}/x`,
            },
          ],
        },
      },
    });
    try {
      const linked = await ranking.yourBestSellers(90, { now: NOW });
      expect(linked?.rows[1].project).toEqual({
        id: project.id,
        name: "Best seller refresh",
      });
      expect(linked?.rows[0].project).toBeNull();
    } finally {
      await db.project.delete({ where: { id: project.id } });
    }
    // A year sells at least what 90 days do.
    const year = await ranking.yourBestSellers(365, { now: NOW });
    expect(year?.orders).toBeGreaterThan(view?.orders ?? 0);
  });

  it("no shop connected, no best sellers", async () => {
    expect(await ranking.yourBestSellers(30, { now: NOW })).toBeNull();
  });

  it("other shops: found by name, ranked by lifetime sales, their listings by favourites", async () => {
    vi.stubGlobal("fetch", etsyFetch(mockEtsy(() => NOW)).fetch);
    const found = await ranking.findShops("pine", NOW);
    expect(found.map((s) => s.name)).toEqual([
      "NorthPineGoods",
      "PineAndPaperStudio",
    ]);
    await watchShop({ shopId: "60013", name: "HarborLinenHouse" });
    await watchShop({ shopId: "60011", name: "NorthPineGoods" });
    expect(await watchShop({ shopId: "60011", name: "NorthPineGoods" })).toBe(
      false,
    );
    const watched = await ranking.watchedShops({ now: NOW });
    expect(watched?.failed).toEqual([]);
    const sold = watched?.standings.map((s) => s.sold) ?? [];
    expect(sold).toEqual([...sold].sort((x, y) => y - x));
    expect(watched?.standings.map((s) => s.shopId).sort()).toEqual([
      "60011",
      "60013",
    ]);
    const top = await ranking.shopFavourites("60011");
    expect(top.read).toBe(24);
    expect(top.listings).toHaveLength(20);
    expect(top.listings[0].favourites).toBeGreaterThanOrEqual(
      top.listings[1].favourites,
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  allPages,
  EtsyError,
  EtsyShop,
  etsyApi,
  etsyGet,
} from "@/providers/shop/etsy";
import { MOCK_SHOP_ID, mockEtsy } from "@/providers/shop/etsy-mock";
import {
  callbackUrlProblem,
  connectUrl,
  exchangeCode,
  pkceChallenge,
  pkcePair,
  refreshTokens,
} from "@/providers/shop/etsy-oauth";

// Etsy without a network: fetch is a stub answering in Etsy's shapes (from
// its OpenAPI spec), and nothing is called.
const app = { keystring: "kstr", sharedSecret: "shh" };

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const shop = {
  shop_id: 7,
  shop_name: "PineGoods",
  url: "https://www.etsy.com/shop/PineGoods",
  create_date: 1_600_000_000,
  transaction_sold_count: 1200,
  num_favorers: 300,
  review_count: 50,
  review_average: 4.8,
  listing_active_count: 40,
  title: "dropped",
  policy_welcome: "dropped",
};

describe("etsyGet", () => {
  it("sends the app's identity and the shop's token, and keeps only what Kiln reads", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json(200, shop),
    );
    const got = await etsyGet(
      app,
      "/shops/7",
      { limit: 5, x: undefined },
      EtsyShop,
      {
        accessToken: "123.tok",
        fetch,
      },
    );
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.etsy.com/v3/application/shops/7?limit=5",
    );
    expect(init?.headers).toMatchObject({
      "x-api-key": "kstr:shh",
      authorization: "Bearer 123.tok",
    });
    expect(got).not.toHaveProperty("title");
    expect(got.transaction_sold_count).toBe(1200);
  });

  it("waits out a 429 as Etsy asks, then tries again", async () => {
    const waits: number[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(429, {}, { "retry-after": "3" }))
      .mockResolvedValueOnce(json(200, shop));
    await etsyGet(app, "/shops/7", {}, EtsyShop, {
      fetch,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([3000]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up on a 429 after two retries, and says Etsy's words for any other failure", async () => {
    const limited = vi.fn(async () => json(429, {}, { "retry-after": "60" }));
    const waits: number[] = [];
    await expect(
      etsyGet(app, "/shops/7", {}, EtsyShop, {
        fetch: limited,
        wait: async (ms) => {
          waits.push(ms);
        },
      }),
    ).rejects.toThrow("Etsy is rate-limiting Kiln's requests");
    expect(waits).toEqual([10_000, 10_000]);
    const refused = vi.fn(async () =>
      json(403, { error: "The shop is not yours" }),
    );
    const error = await etsyGet(app, "/shops/7/receipts", {}, EtsyShop, {
      fetch: refused,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(EtsyError);
    expect(error).toMatchObject({
      status: 403,
      message: "The shop is not yours",
    });
  });

  it("an answer in another shape is refused, not trusted", async () => {
    const fetch = vi.fn(async () => json(200, { shop_id: "seven" }));
    await expect(
      etsyGet(app, "/shops/7", {}, EtsyShop, { fetch }),
    ).rejects.toThrow("did not read as expected");
  });
});

describe("etsyApi", () => {
  it("reads receipts newest first in a window", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json(200, { count: 0, results: [] }),
    );
    await etsyApi(app, { accessToken: "1.t", fetch }).receipts(7, {
      minCreated: 100,
      maxCreated: 200,
      limit: 100,
      offset: 200,
    });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe("/v3/application/shops/7/receipts");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      min_created: "100",
      max_created: "200",
      sort_on: "created",
      sort_order: "desc",
      limit: "100",
      offset: "200",
    });
  });
});

describe("allPages", () => {
  it("reads until the count is reached, or stops at the cap and says so", async () => {
    const read =
      (count: number) =>
      async ({ limit, offset }: { limit: number; offset: number }) => ({
        count,
        results: Array.from(
          { length: Math.max(0, Math.min(limit, count - offset)) },
          (_, i) => offset + i,
        ),
      });
    expect(await allPages(read(250), 5)).toMatchObject({ complete: true });
    expect((await allPages(read(250), 5)).items).toHaveLength(250);
    const capped = await allPages(read(1000), 3);
    expect(capped).toMatchObject({ complete: false });
    expect(capped.items).toHaveLength(300);
    expect(await allPages(read(0), 3)).toEqual({ items: [], complete: true });
  });
});

describe("Etsy OAuth", () => {
  it("PKCE: the S256 challenge of RFC 7636's own example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(pkceChallenge(verifier));
  });

  it("the page where the maker approves Kiln asks for read-only scopes", () => {
    const url = new URL(
      connectUrl({
        keystring: "kstr",
        redirectUri: "https://localhost:3009/api/shops/etsy/callback",
        state: "st",
        challenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://www.etsy.com/oauth/connect",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "kstr",
      redirect_uri: "https://localhost:3009/api/shops/etsy/callback",
      scope: "shops_r listings_r transactions_r",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });

  it("a callback URL is http or https on a host name, as Etsy's portal takes it", () => {
    expect(
      callbackUrlProblem("http://localhost:3009/api/shops/etsy/callback"),
    ).toBeNull();
    expect(callbackUrlProblem("https://kiln.example.com/cb")).toBeNull();
    expect(callbackUrlProblem("http://127.0.0.1:3009/cb")).toMatch(
      "IP address",
    );
    expect(callbackUrlProblem("http://[::1]:3009/cb")).toMatch("IP address");
    expect(callbackUrlProblem("ftp://localhost/cb")).toMatch("http or https");
    expect(callbackUrlProblem("localhost:3009")).not.toBeNull();
  });

  it("trades the code for tokens, the user read from the token", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json(200, {
        access_token: "12345678.abc",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "12345678.ref",
      }),
    );
    const now = new Date("2026-10-27T12:00:00Z");
    const tokens = await exchangeCode(
      app,
      { redirectUri: "https://localhost:3009/cb", code: "cd", verifier: "vf" },
      { fetch, now: () => now },
    );
    expect(tokens).toEqual({
      accessToken: "12345678.abc",
      refreshToken: "12345678.ref",
      expiresAt: new Date("2026-10-27T13:00:00Z"),
      userId: "12345678",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.etsy.com/v3/public/oauth/token");
    expect(init?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual(
      {
        grant_type: "authorization_code",
        client_id: "kstr",
        redirect_uri: "https://localhost:3009/cb",
        code: "cd",
        code_verifier: "vf",
      },
    );
  });

  it("refreshes with the refresh token; a refused one says Etsy's words", async () => {
    const ok = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json(200, {
        access_token: "9.new",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "9.ref2",
      }),
    );
    expect(await refreshTokens(app, "9.ref", { fetch: ok })).toMatchObject({
      accessToken: "9.new",
      refreshToken: "9.ref2",
    });
    expect(
      Object.fromEntries(
        new URLSearchParams(String(ok.mock.calls[0][1]?.body)),
      ),
    ).toEqual({
      grant_type: "refresh_token",
      client_id: "kstr",
      refresh_token: "9.ref",
    });
    const refused = vi.fn(async () =>
      json(400, {
        error: "invalid_grant",
        error_description: "Refresh token expired",
      }),
    );
    await expect(
      refreshTokens(app, "9.old", { fetch: refused }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Refresh token expired",
    });
  });
});

describe("the mock Etsy", () => {
  it("has a connected shop with a year of orders, and shops to look up", async () => {
    const etsy = mockEtsy(() => new Date("2026-10-27T12:00:00Z"));
    const me = await etsy.me();
    expect(me.shop_id).toBe(MOCK_SHOP_ID);
    const now = Date.UTC(2026, 9, 27, 12) / 1000;
    const page = await etsy.receipts(MOCK_SHOP_ID, {
      minCreated: now - 30 * 86_400,
      limit: 100,
      offset: 0,
    });
    expect(page.count).toBeGreaterThan(10);
    expect(page.results[0].created_timestamp).toBeGreaterThanOrEqual(
      page.results.at(-1)?.created_timestamp ?? 0,
    );
    expect((await etsy.findShops("pine")).map((s) => s.shop_name)).toEqual([
      "NorthPineGoods",
      "PineAndPaperStudio",
    ]);
    await expect(
      etsy.receipts(60011, { minCreated: 0, limit: 1, offset: 0 }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

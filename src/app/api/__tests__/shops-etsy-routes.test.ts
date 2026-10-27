import { beforeEach, describe, expect, it, vi } from "vitest";

// The connect and callback routes without Etsy or a database: the server's
// connection is stubbed (shop-connection.db.test.ts covers it).
const state = vi.hoisted(() => ({
  redirectUri: "https://localhost:3009/api/shops/etsy/callback" as
    | string
    | null,
  missing: [] as string[],
  finished: [] as unknown[],
  refuse: null as null | { problem: string; message: string },
}));

vi.mock("@/server/shop-connection", async (original) => {
  const real = await original<typeof import("@/server/shop-connection")>();
  return {
    ...real,
    etsySetup: () => ({
      mode: "live",
      missing: state.missing,
      redirectUri: state.redirectUri,
      publicReads: true,
    }),
    beginConnect: () => {
      if (state.missing.length > 0) {
        throw new real.ConnectRefusal("not-set-up", "add the keys");
      }
      return state.redirectUri
        ? {
            url: "https://www.etsy.com/oauth/connect?state=s1",
            cookie: "v1.a.b.c",
          }
        : {
            url: "/api/shops/etsy/callback?code=mock-code&state=s1",
            cookie: "v1.a.b.c",
          };
    },
    finishConnect: async (input: unknown) => {
      state.finished.push(input);
      if (state.refuse) {
        throw new real.ConnectRefusal(
          state.refuse.problem as "etsy",
          state.refuse.message,
        );
      }
      return { shopName: "MockMakerStudio" };
    },
  };
});

const { GET: connect } = await import("@/app/api/shops/etsy/connect/route");
const { GET: callback } = await import("@/app/api/shops/etsy/callback/route");

beforeEach(() => {
  state.redirectUri = "https://localhost:3009/api/shops/etsy/callback";
  state.missing = [];
  state.finished = [];
  state.refuse = null;
});

const cookies = (res: Response) => res.headers.getSetCookie();

describe("GET /api/shops/etsy/connect", () => {
  it("sends the maker to Etsy, the handshake in a sealed cookie scoped to the routes", async () => {
    const res = await connect(
      new Request("https://localhost:3009/api/shops/etsy/connect"),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://www.etsy.com/oauth/connect?state=s1",
    );
    expect(cookies(res)).toEqual([
      "kiln_etsy_connect=v1.a.b.c; Path=/api/shops/etsy; Max-Age=600; HttpOnly; SameSite=Lax; Secure",
    ]);
  });

  it("starts on the origin Etsy sends the maker back to, once", async () => {
    const res = await connect(
      new Request("http://127.0.0.1:3009/api/shops/etsy/connect"),
    );
    expect(res.headers.get("location")).toBe(
      "https://localhost:3009/api/shops/etsy/connect?hop=1",
    );
    expect(cookies(res)).toEqual([]);
    const again = await connect(
      new Request("http://127.0.0.1:3009/api/shops/etsy/connect?hop=1"),
    );
    expect(again.headers.get("location")).toContain("www.etsy.com");
  });

  it("a mock run goes straight to the callback; a missing key says so on Shops", async () => {
    state.redirectUri = null;
    const mock = await connect(
      new Request("http://127.0.0.1:3010/api/shops/etsy/connect"),
    );
    expect(mock.headers.get("location")).toBe(
      "http://127.0.0.1:3010/api/shops/etsy/callback?code=mock-code&state=s1",
    );
    expect(cookies(mock)[0]).not.toContain("Secure");
    state.missing = ["ETSY_API_KEY"];
    const refused = await connect(
      new Request("https://localhost:3009/api/shops/etsy/connect"),
    );
    expect(refused.headers.get("location")).toBe(
      "https://localhost:3009/shops?connect=not-set-up",
    );
  });
});

describe("GET /api/shops/etsy/callback", () => {
  const back = (query: string, cookie = "kiln_etsy_connect=v1.a.b.c") =>
    callback(
      new Request(`https://localhost:3009/api/shops/etsy/callback?${query}`, {
        headers: { cookie: `other=1; ${cookie}` },
      }),
    );

  it("finishes with the code, the state and the cookie, and lands on Shops", async () => {
    const res = await back("code=c1&state=s1");
    expect(state.finished).toEqual([
      { code: "c1", state: "s1", error: null, cookie: "v1.a.b.c" },
    ]);
    expect(res.headers.get("location")).toBe(
      "https://localhost:3009/shops?connected=1",
    );
    expect(cookies(res)).toEqual([
      "kiln_etsy_connect=; Path=/api/shops/etsy; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
  });

  it("a refusal lands on Shops saying which, with Etsy's words when it was Etsy", async () => {
    state.refuse = { problem: "state", message: "did not match" };
    const forged = await back("code=c1&state=forged");
    expect(forged.headers.get("location")).toBe(
      "https://localhost:3009/shops?connect=state",
    );
    expect(cookies(forged)).toHaveLength(1);
    state.refuse = { problem: "etsy", message: "Etsy said: invalid_grant" };
    const etsy = await back("code=c1&state=s1");
    expect(etsy.headers.get("location")).toBe(
      "https://localhost:3009/shops?connect=etsy",
    );
    expect(cookies(etsy)[1]).toBe(
      "kiln_shops_note=Etsy%20said%3A%20invalid_grant; Path=/shops; Max-Age=60; HttpOnly; SameSite=Lax",
    );
  });
});

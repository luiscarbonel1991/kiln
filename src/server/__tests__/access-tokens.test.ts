import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const verified = vi.hoisted(() => ({ ok: true, seen: [] as string[] }));
vi.mock("@/server/access-tokens", async (original) => ({
  ...(await original<typeof import("@/server/access-tokens")>()),
  verifyAccessToken: async (token: string) => {
    verified.seen.push(token);
    return verified.ok ? { tokenId: "t1", makerId: "m1" } : null;
  },
}));

const { bearerToken, hashToken, newToken, TokenName } = await import(
  "@/server/access-tokens"
);
const { authorize, readBody } = await import("@/server/http-api");

const errorOf = async (response: Response | null) =>
  ((await response?.json()) as { error: string } | undefined)?.error;

const request = (headers: Record<string, string> = {}, body?: BodyInit) =>
  new Request("http://kiln.test/api/import", {
    method: "POST",
    headers,
    body,
  });

describe("access tokens", () => {
  it("a new token is kiln_pat_ and 32 random bytes; only its SHA-256 and its first characters are kept", () => {
    const a = newToken();
    const b = newToken();
    expect(a.token).toMatch(/^kiln_pat_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(createHash("sha256").update(a.token).digest("hex"));
    expect(hashToken(a.token)).toBe(a.hash);
    expect(a.prefix).toBe(a.token.slice(0, 13));
  });

  it("reads a Bearer header in any case and refuses anything not shaped like a token", () => {
    const { token } = newToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer   ${token} `)).toBe(token);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken(`Basic ${token}`)).toBeNull();
    expect(bearerToken("Bearer kiln_pat_short")).toBeNull();
    expect(bearerToken(`Bearer ${token} extra`)).toBeNull();
  });

  it("a token is named after what uses it, in at most 60 characters", () => {
    expect(TokenName.parse("  Catalog exporter ")).toBe("Catalog exporter");
    expect(TokenName.safeParse("  ").success).toBe(false);
    expect(TokenName.safeParse("x".repeat(61)).success).toBe(false);
  });
});

describe("authorize", () => {
  it("without a token: 401, with what to send and where to make one", async () => {
    const denied = await authorize(request());
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get("WWW-Authenticate")).toBe('Bearer realm="kiln"');
    expect(await errorOf(denied)).toMatch(
      /Authorization: Bearer kiln_pat_.*Settings → Access tokens/,
    );
  });

  it("a token Kiln does not know: 401 that says revoked or another maker's; never looked up when malformed", async () => {
    verified.ok = false;
    verified.seen.length = 0;
    const { token } = newToken();
    const denied = await authorize(
      request({ Authorization: `Bearer ${token}` }),
    );
    expect(denied?.status).toBe(401);
    expect(await errorOf(denied)).toMatch(/revoked|another maker/);
    await authorize(request({ Authorization: "Bearer nope" }));
    expect(verified.seen).toEqual([token]);
    verified.ok = true;
  });

  it("a token of the current maker passes", async () => {
    const { token } = newToken();
    expect(
      await authorize(request({ authorization: `Bearer ${token}` })),
    ).toBeNull();
  });
});

describe("readBody", () => {
  it("reads a body under the cap", async () => {
    const bytes = await readBody(request({}, "hello"), 10);
    expect(Buffer.from(bytes ?? []).toString()).toBe("hello");
  });

  it("refuses a body over the cap, declared or not", async () => {
    expect(await readBody(request({}, "x".repeat(11)), 10)).toBeNull();
    expect(
      await readBody(request({ "content-length": "999" }, "small"), 10),
    ).toBeNull();
  });
});

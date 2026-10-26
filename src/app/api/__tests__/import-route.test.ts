import { describe, expect, it, vi } from "vitest";

// The routes' own behaviour, without a database: the token check is stubbed
// (access-tokens.test.ts covers it), and nothing here reaches a save.
const auth = vi.hoisted(() => ({ ok: true }));
vi.mock("@/server/access-tokens", async (original) => ({
  ...(await original<typeof import("@/server/access-tokens")>()),
  verifyAccessToken: async () =>
    auth.ok ? { tokenId: "t1", makerId: "m1" } : null,
}));
const swatch = vi.hoisted(() => ({
  calls: [] as { ref: string; key: string; photo: Uint8Array | null }[],
}));
vi.mock("@/server/product-swatch", () => ({
  setColourSwatch: async (
    ref: string,
    key: string,
    photo: Uint8Array | null,
  ) => {
    swatch.calls.push({ ref, key, photo });
    if (key === "nope") {
      return { ok: false, status: 404, error: `no colour "${key}"` };
    }
    return {
      ok: true,
      product: { id: "p1", sku: ref, name: "Coaster" },
      colour: { key, name: "Oak", face: "#C8A165", swatchUrl: null },
      status: "updated",
      changed: ["colours (Oak changed)"],
      behind: [],
    };
  },
}));

const { POST: importPost } = await import("@/app/api/import/route");
const swatchRoute = await import(
  "@/app/api/products/[id]/colours/[key]/swatch/route"
);
const { newToken } = await import("@/server/access-tokens");

const TOKEN = newToken().token;
const authed = (headers: Record<string, string> = {}) => ({
  Authorization: `Bearer ${TOKEN}`,
  ...headers,
});
const post = (
  url: string,
  body: BodyInit | undefined,
  headers: Record<string, string> = authed(),
) => new Request(`http://kiln.test${url}`, { method: "POST", headers, body });
const ctx = (id: string, key: string) => ({
  params: Promise.resolve({ id, key }),
});

const coaster = {
  id: "api:AP-01",
  sku: "AP-01",
  name: "API test coaster",
  family: "Home",
  dimensions: { w: 4, h: 4, unit: "in" },
  shape: "round coaster",
  material: "birch",
  treatment: "engraved",
  colours: [{ key: "natural", name: "Natural", face: "#D9B98C" }],
  defaultColour: "natural",
  typography: { family: "Hanken Grotesk" },
  source: { kind: "vector", svgUrl: "http://169.254.169.254/plate.svg" },
};

describe("POST /api/import", () => {
  it("refuses a call without a valid token, before reading the body", async () => {
    auth.ok = false;
    const res = await importPost(post("/api/import", "{}"));
    auth.ok = true;
    expect(res.status).toBe(401);
    const none = await importPost(post("/api/import", "{}", {}));
    expect(none.status).toBe(401);
  });

  it("400 for a body that is not JSON, 413 over the cap, 422 for no products", async () => {
    expect((await importPost(post("/api/import", "not json"))).status).toBe(
      400,
    );
    const big = await importPost(
      post(
        "/api/import",
        "{}",
        authed({ "content-length": String(33 * 1024 * 1024) }),
      ),
    );
    expect(big.status).toBe(413);
    const empty = await importPost(post("/api/import", "[]"));
    expect(empty.status).toBe(422);
    expect((await empty.json()).error).toMatch(/No products found/);
  });

  it("answers product by product: one set aside with its reason, in the same words as the page", async () => {
    const res = await importPost(
      post(
        "/api/import",
        JSON.stringify({ products: [coaster, { ...coaster, sku: "" }] }),
        authed({ "Content-Type": "application/json" }),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      imported: [],
      brandSaved: false,
      brandErrors: [],
      warnings: [],
    });
    expect(body.rejected).toEqual([
      { label: "API test coaster", errors: ["sku: is empty"] },
      {
        label: '"AP-01" API test coaster',
        errors: [expect.stringContaining("KILN_ASSET_ORIGINS")],
      },
    ]);
  });
});

describe("POST /api/products/:id/colours/:key/swatch", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );

  it("takes the photo as the raw body, for a product named by its sku", async () => {
    swatch.calls.length = 0;
    const res = await swatchRoute.POST(
      post(
        "/api/products/AP-01/colours/oak/swatch",
        PNG,
        authed({ "Content-Type": "image/png" }),
      ),
      ctx("AP-01", "oak"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      product: { sku: "AP-01" },
      status: "updated",
    });
    expect(swatch.calls[0].ref).toBe("AP-01");
    expect(Buffer.from(swatch.calls[0].photo ?? []).equals(PNG)).toBe(true);
  });

  it("takes the photo from a multipart form's file field", async () => {
    swatch.calls.length = 0;
    const form = new FormData();
    form.set("file", new File([PNG], "oak.png", { type: "image/png" }));
    const res = await swatchRoute.POST(
      new Request("http://kiln.test/api/products/p1/colours/oak/swatch", {
        method: "POST",
        headers: authed(),
        body: form,
      }),
      ctx("p1", "oak"),
    );
    expect(res.status).toBe(200);
    expect(Buffer.from(swatch.calls[0].photo ?? []).equals(PNG)).toBe(true);
  });

  it("400 for no photo; the service's refusal keeps its status and words; DELETE removes", async () => {
    const empty = await swatchRoute.POST(
      post("/api/products/p1/colours/oak/swatch", undefined),
      ctx("p1", "oak"),
    );
    expect(empty.status).toBe(400);
    const missing = await swatchRoute.POST(
      post("/api/products/p1/colours/nope/swatch", PNG),
      ctx("p1", "nope"),
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe('no colour "nope"');
    swatch.calls.length = 0;
    const removed = await swatchRoute.DELETE(
      new Request("http://kiln.test/api/products/p1/colours/oak/swatch", {
        method: "DELETE",
        headers: authed(),
      }),
      ctx("p1", "oak"),
    );
    expect(removed.status).toBe(200);
    expect(swatch.calls).toEqual([{ ref: "p1", key: "oak", photo: null }]);
  });

  it("a 15 MB photo fits in a multipart form; a larger one is refused", async () => {
    const photoOfSize = (bytes: number) => {
      const photo = Buffer.alloc(bytes);
      PNG.copy(photo);
      const form = new FormData();
      form.set("file", new File([photo], "oak.png", { type: "image/png" }));
      return swatchRoute.POST(
        new Request("http://kiln.test/api/products/p1/colours/oak/swatch", {
          method: "POST",
          headers: authed(),
          body: form,
        }),
        ctx("p1", "oak"),
      );
    };
    swatch.calls.length = 0;
    const atCap = await photoOfSize(15 * 1024 * 1024);
    expect(atCap.status).toBe(200);
    expect(swatch.calls[0].photo?.length).toBe(15 * 1024 * 1024);
    const over = await photoOfSize(15 * 1024 * 1024 + 1);
    expect(over.status).toBe(413);
  });

  it("refuses without a token, and over 15 MB", async () => {
    auth.ok = false;
    const denied = await swatchRoute.DELETE(
      new Request("http://kiln.test/x", { method: "DELETE" }),
      ctx("p1", "oak"),
    );
    auth.ok = true;
    expect(denied.status).toBe(401);
    const big = await swatchRoute.POST(
      post(
        "/api/products/p1/colours/oak/swatch",
        PNG,
        authed({ "content-length": String(16 * 1024 * 1024) }),
      ),
      ctx("p1", "oak"),
    );
    expect(big.status).toBe(413);
  });
});

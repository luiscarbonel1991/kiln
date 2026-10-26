import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

// The HTTP API end to end against the throwaway Postgres (see
// project-repository.db.test.ts for the setup): a real token, the routes, the
// import and the product row. Storage is stubbed (named by the bytes, like
// the real one).
vi.mock("@/providers/asset-bytes", async (original) => ({
  ...(await original<typeof import("@/providers/asset-bytes")>()),
  storeAsset: async (bytes: Uint8Array, mime: string, prefix: string) =>
    `https://storage.test/${prefix}/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${mime.split("/")[1]}`,
}));

const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!enabled)("HTTP API (database)", async () => {
  const { db } = await import("@/lib/db");
  const tokens = await import("@/server/access-tokens");
  const { findProduct } = await import("@/server/product-repository");
  const { POST: importPost } = await import("@/app/api/import/route");
  const swatch = await import(
    "@/app/api/products/[id]/colours/[key]/swatch/route"
  );

  const { token, created } = await tokens.createAccessToken("API test");
  const sku = `HA-${Date.now()}`;
  const pkg = {
    products: [
      {
        id: `api:${sku}`,
        sku,
        name: "API test coaster",
        family: "Home",
        dimensions: { w: 4, h: 4, unit: "in" },
        shape: "round coaster",
        material: "birch",
        treatment: "engraved",
        colours: [
          { key: "oak", name: "Oak", face: "#C8A165" },
          { key: "maple", name: "Maple", face: "#E3C99A" },
        ],
        defaultColour: "oak",
        typography: { family: "Hanken Grotesk" },
        source: { kind: "form" },
      },
    ],
  };
  const headers = { Authorization: `Bearer ${token}` };
  const send = (body: BodyInit) =>
    importPost(
      new Request("http://kiln.test/api/import", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body,
      }),
    );
  const photo = (key: string, body: BodyInit, ref = sku) =>
    swatch.POST(
      new Request(
        `http://kiln.test/api/products/${ref}/colours/${key}/swatch`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "image/png" },
          body,
        },
      ),
      { params: Promise.resolve({ id: ref, key }) },
    );

  afterAll(async () => {
    await db.product.deleteMany({ where: { sku } });
    await tokens.revokeAccessToken(created.id);
  });

  it("imports a package and answers with each product's id and colour keys", async () => {
    const res = await send(JSON.stringify(pkg));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rejected).toEqual([]);
    expect(body.imported).toEqual([
      {
        id: expect.any(String),
        sku,
        name: "API test coaster",
        status: "new",
        changed: [],
        colours: [
          { key: "oak", name: "Oak", swatchUrl: null },
          { key: "maple", name: "Maple", swatchUrl: null },
        ],
      },
    ]);
    expect((await findProduct(sku))?.id).toBe(body.imported[0].id);
  });

  it("a material photo by sku: stored by its bytes, the swatch hex kept; the same photo again changes nothing", async () => {
    const res = await photo("oak", PNG);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      product: { sku },
      colour: {
        key: "oak",
        face: "#C8A165",
        swatchUrl: expect.stringMatching(
          /^https:\/\/storage\.test\/products\/[0-9a-f]{32}\.png$/,
        ),
      },
      status: "updated",
      changed: ["colours (Oak changed)"],
      behind: [],
    });
    const stored = await findProduct(sku);
    expect(stored?.colours[0]).toMatchObject({
      face: "#C8A165",
      swatchUrl: body.colour.swatchUrl,
    });
    const again = await (await photo("oak", PNG)).json();
    expect(again).toMatchObject({ status: "unchanged", changed: [] });
  });

  it("refuses what is not a photo, a colour it does not have and a product it does not know", async () => {
    const svg = await photo("oak", "<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(svg.status).toBe(415);
    const colour = await photo("walnut", PNG);
    expect(colour.status).toBe(404);
    expect((await colour.json()).error).toBe(
      `"${sku}" has no colour "walnut"; its colours are oak, maple.`,
    );
    const product = await photo("oak", PNG, "NO-SUCH-SKU");
    expect(product.status).toBe(404);
  });

  it("DELETE removes the photo", async () => {
    const res = await swatch.DELETE(
      new Request(`http://kiln.test/api/products/${sku}/colours/oak/swatch`, {
        method: "DELETE",
        headers,
      }),
      { params: Promise.resolve({ id: sku, key: "oak" }) },
    );
    expect(await res.json()).toMatchObject({
      status: "updated",
      colour: { key: "oak", swatchUrl: null },
    });
    expect((await findProduct(sku))?.colours[0].swatchUrl).toBeUndefined();
  });

  it("a revoked token is refused", async () => {
    const other = await tokens.createAccessToken("Revoked API test");
    await tokens.revokeAccessToken(other.created.id);
    const res = await importPost(
      new Request("http://kiln.test/api/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${other.token}` },
        body: JSON.stringify(pkg),
      }),
    );
    expect(res.status).toBe(401);
  });
});

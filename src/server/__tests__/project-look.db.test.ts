import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));
// What Kiln draws is stored in memory; data: designs are read as they are.
const storage = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/providers/asset-bytes", async (original) => {
  const real = await original<typeof import("@/providers/asset-bytes")>();
  return {
    ...real,
    fetchAsset: async (url: string) => {
      const bytes = storage.get(url);
      if (!bytes) return real.fetchAsset(url);
      return {
        bytes: Buffer.from(bytes),
        base64: "",
        mime: url.endsWith(".svg") ? "image/svg+xml" : "image/png",
      };
    },
    storeAsset: async (bytes: Uint8Array, mime: string, prefix: string) => {
      const url = `https://stub.local/${prefix}/${storage.size}.${mime === "image/svg+xml" ? "svg" : "png"}`;
      storage.set(url, bytes);
      return url;
    },
  };
});

// A project in a look other than its product's default (the throwaway
// Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("the project's look (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { startProject } = await import("@/server/start-project");
  const { upsertProducts, getProduct, updateProduct } = await import(
    "@/server/product-repository"
  );
  const { updateProjectProductAction } = await import("@/app/actions/board");
  const { Product } = await import("@/domain/product");
  const { DOOR_TAG } = await import("@/domain/__tests__/fixtures/door-tag");

  const sku = `PL-${Date.now()}`;
  const created: string[] = [];
  afterAll(async () => {
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  it("starts in the colour and style picked, drawn by Kiln, and leaves the product's default alone", async () => {
    const [saved] = await upsertProducts([Product.parse({ ...DOOR_TAG, sku })]);
    const started = await startProject({
      productId: saved.id,
      type: "listing-kit",
      destinationIds: ["etsy"],
      look: { colour: "gold-black", style: "do-not-disturb" },
    });
    if ("error" in started) throw new Error(started.error);
    created.push(started.id);
    const loaded = await repo.loadProjectBoard(started.id);
    const plan = loaded?.board.plan;
    expect(plan?.look).toEqual({
      colour: "gold-black",
      style: "do-not-disturb",
    });
    const [drawn] = plan?.references?.looks ?? [];
    expect(drawn).toMatchObject({
      colour: "gold-black",
      style: "do-not-disturb",
    });
    expect(loaded?.board.master?.assetUrl).toBe(drawn.front);
    expect(
      Buffer.from(storage.get(drawn.design) ?? new Uint8Array()).toString(),
    ).toContain('fill="#D3B66F"');
    // Every scene is written in gold, with gold's material sample.
    const scene = loaded?.board.cards.find((c) => c.type === "image");
    expect(scene?.references).toEqual([
      "https://storage.test/products/gold.jpg",
    ]);
    expect(scene?.fields.palette.value).toContain("#D3B66F");
    expect((await getProduct(saved.id))?.defaultColour).toBe("black-white");
  });

  it("refuses a look the product does not offer", async () => {
    const saved = await getProduct(
      (await db.product.findFirstOrThrow({ where: { sku } })).id,
    );
    expect(
      await startProject({
        productId: saved?.id,
        type: "listing-kit",
        destinationIds: ["etsy"],
        look: { colour: "copper" },
      }),
    ).toEqual({ error: 'Engraved door tag has no colour "copper".' });
  });

  it("an update draws the project's look again from the product as it is now", async () => {
    const [id] = created;
    const before = await repo.loadProjectBoard(id);
    const product = before?.product;
    if (!product) throw new Error("no product");
    await updateProduct(
      product.id,
      Product.parse({ ...product, material: "brushed two-tone laminate" }),
    );
    expect(await updateProjectProductAction({ projectId: id })).toBeUndefined();
    const after = await repo.loadProjectBoard(id);
    const [drawn] = after?.board.plan?.references?.looks ?? [];
    expect(after?.board.plan?.look).toEqual(before?.board.plan?.look);
    expect(drawn.colour).toBe("gold-black");
    expect(drawn.front).not.toBe(
      before?.board.plan?.references?.looks?.[0].front,
    );
    expect(after?.board.master?.assetUrl).toBe(drawn.front);
  });
});

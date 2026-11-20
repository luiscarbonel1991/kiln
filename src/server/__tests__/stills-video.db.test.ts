import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it, vi } from "vitest";

// Storage stubbed: an approved scene is a PNG; what Kiln stores is kept in
// memory.
const storage = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/providers/asset-bytes", async (original) => {
  const real = await original<typeof import("@/providers/asset-bytes")>();
  return {
    ...real,
    fetchAsset: async (url: string) => {
      const bytes =
        storage.get(url) ??
        new Uint8Array(
          execFileSync("magick", ["-size", "800x1000", "xc:#3F5F3A", "png:-"]),
        );
      return { bytes: Buffer.from(bytes), base64: "", mime: "image/png" };
    },
    storeAsset: async (bytes: Uint8Array, mime: string, prefix: string) => {
      const url = `https://stub.local/${prefix}/${storage.size}.${mime === "video/mp4" ? "mp4" : "bin"}`;
      storage.set(url, bytes);
      return url;
    },
  };
});

// The stills-in-motion video, made and given to the video card (the
// throwaway Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("stills in motion (database)", async () => {
  const maker = enabled
    ? await (await import("@/server/maker-repository")).getCurrentMaker()
    : { id: "" };
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { upsertProducts } = await import("@/server/product-repository");
  const { makeStillsVideo } = await import("@/server/stills-video");
  const { planProject, withVideoChoice } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { CATALOG } = await import("@/lib/recipes");
  const { photoReference, startEditorState } = await import(
    "@/lib/project-start"
  );

  const sku = `SV-${Date.now()}`;
  const created: string[] = [];
  afterAll(async () => {
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  it("makes the video from the approved scenes, free, as the video card's take", async () => {
    const [product] = await upsertProducts(maker, [
      Product.parse({
        id: "pkg:SV",
        sku,
        name: "Stills test coaster",
        family: "Home",
        dimensions: { w: 4, h: 4, unit: "in" },
        shape: "round coaster",
        material: "birch plywood",
        treatment: "engraved",
        colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
        defaultColour: "birch",
        typography: { family: "Fraunces" },
        source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
      }),
    ]);
    const planned = planProject({
      product,
      type: "listing-kit",
      destinationIds: ["etsy"],
      catalog: CATALOG,
    });
    const id = await repo.createProject(maker, {
      type: "listing-kit",
      product,
      plan: planned,
      editor: startEditorState({
        product,
        type: "listing-kit",
        plan: planned,
        master: photoReference(product),
      }),
    });
    created.push(id);
    const ref = { destinationId: "etsy", slotKey: "video" };

    expect(await makeStillsVideo(maker, id, ref)).toEqual({
      error: "Choose stills in motion for this video first.",
    });

    // Two scenes approved, and stills chosen for the video.
    const approved = {
      ...withVideoChoice(planned, ref, { stills: true, seconds: 8 }),
      destinations: planned.destinations.map((d) => ({
        ...d,
        slots: d.slots.map((s) =>
          s.key === "hero" || s.key === "in-use"
            ? { ...s, approvedOutput: `https://stub.local/${s.key}.png` }
            : s.key === "video"
              ? { ...s, video: { stills: true, seconds: 8 } }
              : s,
        ),
      })),
    };
    await db.project.update({ where: { id }, data: { plan: approved } });
    const made = await makeStillsVideo(maker, id, ref);
    if ("error" in made) throw new Error(made.error);
    expect(made.url).toMatch(/\/stills\/\d+\.mp4$/);
    const card = await db.card.findUniqueOrThrow({
      where: { projectId_cardId: { projectId: id, cardId: "etsy.video" } },
    });
    expect(card).toMatchObject({ status: "done", outputs: [made.url] });
    // Nothing was paid: no job was queued.
    expect(await db.generationJob.count({ where: { projectId: id } })).toBe(0);
  });
});

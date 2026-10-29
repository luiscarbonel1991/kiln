import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));
// The estimate only: no key is read and nothing is called.
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: () => true,
}));

// A Launch makes each scene once: the carousel shares Etsy's in-use scene,
// and the square post re-frames it once it is approved (the throwaway
// Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("versions and shared frames (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { estimateProjectCards } = await import("@/server/generation-queue");
  const { QueueRefusal } = await import("@/server/generation-repository");
  const { upsertProducts } = await import("@/server/product-repository");
  const { approveSlot, planProject } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { CATALOG } = await import("@/lib/recipes");
  const { photoReference, startEditorState } = await import(
    "@/lib/project-start"
  );

  const sku = `VR-${Date.now()}`;
  const created: string[] = [];
  afterAll(async () => {
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  it("the post waits for Etsy's in-use scene, then re-frames the approved image", async () => {
    const [product] = await upsertProducts([
      Product.parse({
        id: "pkg:VR",
        sku,
        name: "Version test coaster",
        family: "Kitchen",
        dimensions: { w: 4, h: 4, unit: "in" },
        shape: "round coaster",
        material: "cork",
        treatment: "engraved",
        colours: [{ key: "cork", name: "Cork", face: "#C9A27A" }],
        defaultColour: "cork",
        typography: { family: "Fraunces" },
        source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
      }),
    ]);
    const master = photoReference(product);
    if (!master) throw new Error("no reference");
    const plan = planProject({
      product,
      type: "launch",
      destinationIds: ["etsy", "instagram"],
      catalog: CATALOG,
    });
    const id = await repo.createProject({
      type: "launch",
      product,
      plan,
      editor: startEditorState({ product, type: "launch", plan, master }),
    });
    created.push(id);

    await expect(estimateProjectCards(id, ["instagram.post"])).rejects.toThrow(
      QueueRefusal,
    );
    await expect(estimateProjectCards(id, ["instagram.post"])).rejects.toThrow(
      'Approve "In-use mockup" first',
    );

    const approved = "https://stub.local/in-use-take.png";
    await repo.changePlan(id, (p) =>
      approveSlot(
        p,
        { destinationId: "etsy", slotKey: "in-use" },
        { status: "done", outputs: [approved] },
      ),
    );
    const [post] = (await estimateProjectCards(id, ["instagram.post"])).cards;
    expect(post.request).toMatchObject({
      kind: "image",
      masterAssetUrl: approved,
      model: { aspect: "1:1" },
    });
    expect(post.request.prompt).toContain("square 1:1 frame");

    // The carousel's own "in place" is Etsy's approved scene, shared.
    const board = await repo.loadProjectBoard(id);
    const shared = board?.board.plan?.destinations
      .find((d) => d.destinationId === "instagram")
      ?.slots.find((s) => s.key === "in-place");
    expect(shared).toMatchObject({ fill: "shared", approvedOutput: approved });
  });
});

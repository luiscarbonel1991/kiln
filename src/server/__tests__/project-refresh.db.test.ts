import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));
// The queue refuses a live job whose provider has no key; tests run key-free.
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: () => true,
}));

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "product changed — update the project (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const repo = await import("@/server/project-repository");
    const { upsertProducts } = await import("@/server/product-repository");
    const { updateProjectProductAction } = await import("@/app/actions/board");
    const { productDrift } = await import("@/server/product-version");
    const { planProject } = await import("@/domain/plan");
    const { Product } = await import("@/domain/product");
    const { CATALOG } = await import("@/lib/recipes");
    const { photoReference, startEditorState } = await import(
      "@/lib/project-start"
    );

    const sku = `PR-${Date.now()}`;
    const product = Product.parse({
      id: "pkg:PR-01",
      sku,
      name: "Refresh test coaster",
      family: "Home",
      dimensions: { w: 4, h: 4, unit: "in" },
      shape: "round coaster",
      material: "birch plywood",
      treatment: "engraved",
      colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
      defaultColour: "birch",
      typography: { family: "Fraunces" },
      useContexts: ["a coffee table"],
      source: { kind: "photo", assetUrl: "https://stub.local/coaster.png" },
    });
    const created: string[] = [];

    afterAll(async () => {
      await db.project.deleteMany({ where: { id: { in: created } } });
      await db.product.deleteMany({ where: { sku: { startsWith: sku } } });
    });

    it("brings the project to the product's current version, keeping the maker's own edits", async () => {
      const [saved] = await upsertProducts([product]);
      const plan = planProject({
        product: saved,
        type: "launch",
        destinationIds: ["etsy"],
        catalog: CATALOG,
      });
      const editor = startEditorState({
        product: saved,
        type: "launch",
        plan,
        master: photoReference(saved),
      });
      const id = await repo.createProject({
        type: "launch",
        product: saved,
        plan,
        editor,
      });
      created.push(id);
      const [first] = editor.cards;
      // A saved listing: the title the maker wrote, the rest from the spec.
      const { listingDraft } = await import("@/domain/listing");
      const { SEED_DESTINATIONS } = await import("@/domain/seed");
      const etsyText = SEED_DESTINATIONS.find((d) => d.id === "etsy")?.text;
      await repo.setListing(id, "etsy", {
        ...listingDraft(saved, etsyText),
        title: { value: "My coaster title", source: "maker" },
      });
      await db.card.update({
        where: { projectId_cardId: { projectId: id, cardId: first.id } },
        data: {
          fields: {
            ...first.fields,
            mood: { value: "moody blue", source: "local", locked: false },
          },
        },
      });

      const sample = "https://stub.local/birch-sample.jpg";
      const view = "https://stub.local/birch-top.png";
      const [changed] = await upsertProducts([
        {
          ...saved,
          material: "solid oak",
          colours: [{ ...saved.colours[0], swatchUrl: sample }],
          views: [{ label: "top", url: view }],
        },
      ]);
      const before = await repo.loadProjectBoard(id);
      if (!before?.version || !before.product) throw new Error("no version");
      expect(productDrift(before.product, before.version)).toEqual({
        stale: true,
        changed: ["reference views", "material", "colours (Birch changed)"],
      });
      const { estimateProjectCards } = await import(
        "@/server/generation-queue"
      );
      const [old] = (await estimateProjectCards(id, [first.id])).cards;
      expect(old.request.kind === "image" && old.request.imageInputs).toEqual(
        [],
      );

      expect(
        await updateProjectProductAction({ projectId: id }),
      ).toBeUndefined();

      const after = await repo.loadProjectBoard(id);
      if (!after?.version) throw new Error("no version");
      expect(productDrift(changed, after.version).stale).toBe(false);
      const card = after.board.cards.find((c) => c.id === first.id);
      expect(card?.fields.mood).toEqual({
        value: "moody blue",
        source: "local",
        locked: false,
      });
      expect(card?.fields.subject.value).toContain("solid oak");
      // The material sample now travels with the reference, and is priced.
      expect(card?.references).toEqual([sample, view]);
      const [now] = (await estimateProjectCards(id, [first.id])).cards;
      expect(now.request.kind === "image" && now.request.imageInputs).toEqual([
        sample,
        view,
      ]);
      expect(now.maxMicros).toBeGreaterThan(old.maxMicros);
      // The listing follows the product where it is still the spec's.
      const listing = after.board.plan?.destinations[0].listing;
      expect(listing?.title).toEqual({
        value: "My coaster title",
        source: "maker",
      });
      expect(listing?.materials).toEqual({
        value: ["solid oak"],
        source: "spec",
      });
      const row = await db.project.findUniqueOrThrow({ where: { id } });
      expect(JSON.stringify(row.understanding)).toContain("solid oak");
    });

    it("reflects the plan: a second colour adds Colour options, keeping approvals", async () => {
      const { replan } = await import("@/domain/plan");
      const one = Product.parse({
        ...product,
        id: "pkg:PR-02",
        sku: `${sku}-B`,
      });
      const [saved] = await upsertProducts([one]);
      const plan = planProject({
        product: saved,
        type: "launch",
        destinationIds: ["etsy"],
        catalog: CATALOG,
      });
      const keys = (p: typeof plan | null | undefined) =>
        p?.destinations[0].slots.map((s) => s.key) ?? [];
      expect(keys(plan)).not.toContain("colours");
      const scene = plan.destinations[0].slots.find((s) => s.fill === "scene");
      if (!scene) throw new Error("no scene slot");
      const approved = {
        ...plan,
        destinations: [
          {
            ...plan.destinations[0],
            slots: plan.destinations[0].slots.map((s) =>
              s.key === scene.key
                ? { ...s, approvedOutput: "https://stub.local/ok.png" }
                : s,
            ),
          },
        ],
      };
      const id = await repo.createProject({
        type: "launch",
        product: saved,
        plan: approved,
        editor: startEditorState({
          product: saved,
          type: "launch",
          plan: approved,
          master: photoReference(saved),
        }),
      });
      created.push(id);

      const [two] = await upsertProducts([
        {
          ...saved,
          colours: [
            ...saved.colours,
            { key: "walnut", name: "Walnut", face: "#5C4033", inStock: true },
          ],
        },
      ]);
      const before = await repo.loadProjectBoard(id);
      if (!before?.board.plan) throw new Error("no plan");
      // The banner's preview is what the update then does.
      const preview = replan(before.board.plan, two, CATALOG.shotLists);
      expect(preview.changes).toEqual([
        {
          destinationId: "etsy",
          key: "colours",
          label: "Colour options",
          change: "adds",
        },
      ]);

      expect(
        await updateProjectProductAction({ projectId: id }),
      ).toBeUndefined();
      const after = await repo.loadProjectBoard(id);
      expect(keys(after?.board.plan)).toEqual(keys(preview.plan));
      expect(keys(after?.board.plan)).toContain("colours");
      expect(
        after?.board.plan?.destinations[0].slots.find(
          (s) => s.key === scene.key,
        )?.approvedOutput,
      ).toBe("https://stub.local/ok.png");

      // Again: nothing left to add.
      expect(
        await updateProjectProductAction({ projectId: id }),
      ).toBeUndefined();
      const again = await repo.loadProjectBoard(id);
      expect(keys(again?.board.plan)).toEqual(keys(after?.board.plan));
    });
  },
);

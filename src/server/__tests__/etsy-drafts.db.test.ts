import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { etsyFetch, sentBody } from "@/server/__fixtures__/etsy-fetch";

// Etsy drafts against a migrated throwaway Postgres (see
// project-repository.db.test.ts), on the live code paths: the shop is
// connected through the real handshake, fetch answers from the mock shop and
// its drafts in Etsy's shapes, and the project's delivery is a stand-in, so
// nothing leaves the machine and no frame is rendered.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

vi.mock("@/lib/env", async (original) => {
  const real = await original<typeof import("@/lib/env")>();
  return {
    env: {
      ...real.env,
      // Its own maker: the Shops suite connects and disconnects the default
      // one's shop at the same time.
      KILN_MAKER: "etsy-drafts-test",
      ETSY_API_KEY: "kstr",
      ETSY_SHARED_SECRET: "shh",
      ETSY_REDIRECT_URI: "https://localhost:3009/api/shops/etsy/callback",
    },
  };
});

const stand = vi.hoisted(() => ({ delivery: null as unknown }));
vi.mock("@/server/deliver/deliver-destination", () => ({
  destinationDelivery: async () => stand.delivery,
}));
vi.mock("@/server/deliver/delivery", async (original) => {
  const real = await original<typeof import("@/server/deliver/delivery")>();
  return {
    ...real,
    // Each photo slot as a small JPEG, numbered as the delivery numbers it.
    deliveredFiles: async (input: {
      plan: {
        slots: { key: string; label: string; off?: boolean; fill?: string }[];
      };
    }) => ({
      folder: "kit-etsy",
      files: input.plan.slots
        .filter((s) => !s.off && s.fill !== "video")
        .map((s, i) => ({
          meta: {
            file: `${String(i + 1).padStart(2, "0")}-${s.key}.jpg`,
            photo: i + 1,
            slot: s.key,
            label: s.label,
            kind: "exact",
            width: 2000,
            height: 2000,
          },
          bytes: new Uint8Array([255, 216, 255, i]),
        })),
    }),
  };
});

describe.skipIf(!enabled)("Etsy drafts (database)", async () => {
  const maker = enabled
    ? await (await import("@/server/maker-repository")).getCurrentMaker()
    : { id: "" };
  const { db } = await import("@/lib/db");
  const shops = await import("@/server/shop-connection");
  const drafts = await import("@/server/etsy-drafts");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { mockEtsy, MOCK_SHOP_ID } = await import("@/providers/shop/etsy-mock");
  const { mockEtsyDrafts, newMockDraftStore } = await import(
    "@/providers/shop/etsy-drafts-mock"
  );
  const { PlanDestination } = await import("@/domain/plan");
  const { DraftSettings } = await import("@/domain/etsy-draft");
  const { listingDraft } = await import("@/domain/listing");
  const { SEED_DESTINATIONS } = await import("@/domain/seed");
  const { parseProductPackage } = await import("@/domain/product-package");
  const pkg = (await import("../../lib/__fixtures__/product-package.json"))
    .default;

  const parsed = parseProductPackage(pkg);
  if (!parsed.ok) throw new Error("fixture package does not parse");
  const product = { ...parsed.products[1], id: "prod-drafts-test", price: 24 };
  const etsyDestination = SEED_DESTINATIONS.find((d) => d.id === "etsy");
  if (!etsyDestination?.text) throw new Error("Etsy has no text rules");
  const plan = PlanDestination.parse({
    destinationId: "etsy",
    shotListId: "etsy-listing",
    slots: [
      {
        key: "colours",
        label: "Colours",
        purpose: "p",
        aspect: "1:1",
        fill: "exact",
        exact: "colour-grid",
      },
      {
        key: "scale",
        label: "Scale",
        purpose: "p",
        aspect: "1:1",
        fill: "exact",
        exact: "scale",
      },
      { key: "gift", label: "Gift", purpose: "p", aspect: "4:5", off: true },
      // Not approved: the video is not sent, so it holds nothing back.
      {
        key: "video",
        label: "Listing video",
        purpose: "p",
        aspect: "9:16",
        fill: "video",
      },
    ],
  });
  const PROJECT = "proj-drafts-test";
  const PLAIN = MOCK_SHOP_ID * 1000 + 501;
  const VARIED = MOCK_SHOP_ID * 1000 + 502;
  const LIVE = MOCK_SHOP_ID * 1000 + 1;

  let etsy: ReturnType<typeof etsyFetch>;
  let failing: (method: string, path: string) => Response | undefined;

  async function connect() {
    const now = Date.now();
    failing = () => undefined;
    etsy = etsyFetch(
      mockEtsy(() => new Date(now)),
      [
        {
          body: {
            access_token: "90001.access-1",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "90001.refresh-1",
          },
        },
      ],
      {
        drafts: mockEtsyDrafts({ store: newMockDraftStore() }),
        fail: (method, path) => failing(method, path),
      },
    );
    vi.stubGlobal("fetch", etsy.fetch);
    const { url, cookie } = shops.beginConnect(now);
    await shops.finishConnect(maker, {
      code: "the-code",
      state: new URL(url).searchParams.get("state"),
      cookie,
      now,
    });
  }

  // The writes to the shop (not the OAuth token trade).
  const writes = () =>
    etsy.calls.filter(
      (c) =>
        (c.init?.method ?? "GET") !== "GET" &&
        c.url.pathname.startsWith("/v3/application"),
    );

  beforeEach(async () => {
    const maker = await getCurrentMaker();
    await shops.disconnectShop(maker);
    await db.shopWrite.deleteMany({ where: { makerId: maker.id } });
    stand.delivery = {
      product,
      input: {
        projectName: "Coaster — Listing kit",
        product,
        destination: etsyDestination,
        plan,
        cardOf: () => undefined,
        listing: listingDraft(product, etsyDestination.text),
        now: new Date(),
      },
    };
    await connect();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    const maker = await getCurrentMaker();
    await db.maker.delete({ where: { id: maker.id } });
  });

  it("lists the shop's drafts, and writes nothing on a shop connected before drafts", async () => {
    const maker = await getCurrentMaker();
    const listed = await drafts.listDrafts(maker);
    expect(listed.drafts.map((d) => d.listingId).sort()).toEqual([
      PLAIN,
      VARIED,
    ]);
    expect(listed.draftsAllowed).toBe(true);
    await db.shopConnection.update({
      where: { makerId_platform: { makerId: maker.id, platform: "etsy" } },
      data: { scopes: "shops_r listings_r transactions_r" },
    });
    expect((await shops.shopConnection(maker))?.draftsAllowed).toBe(false);
    await expect(
      drafts.updateDraft(maker, PLAIN, { title: "New title" }, "Drafts page"),
    ).rejects.toThrow("connect the shop again");
    expect(writes()).toEqual([]);
  });

  it("previews a draft from the project, with Kiln's first guesses", async () => {
    const preview = await drafts.previewDraft(maker, PROJECT, "etsy");
    expect(preview.settings).toMatchObject({
      quantity: 10,
      readinessStateId: 8001,
      whoMade: "i_did",
      whenMade: "made_to_order",
    });
    // Two shipping profiles and no live listing naming one: the maker picks.
    expect(preview.settings.shippingProfileId).toBeUndefined();
    expect(preview.blockers).toEqual([
      "Choose the Etsy category.",
      "Choose the shipping profile: Etsy needs one for a physical item.",
    ]);
    expect(preview.fields).toBeNull();
    expect(preview.photos.map((p) => p.file)).toEqual([
      "01-colours",
      "02-scale",
    ]);
    expect(preview.notSent).toContain("The video: upload it in Etsy's editor.");
    const chosen = await drafts.previewDraft(maker, PROJECT, "etsy", {
      taxonomyId: 1063,
      shippingProfileId: 7001,
    });
    expect(chosen.blockers).toEqual([]);
    expect(chosen.fields).toMatchObject({ price: 24, taxonomyId: 1063 });
    expect(chosen.requestKey).not.toBe(preview.requestKey);
  });

  it("makes the draft once, with its photos, logged and read back", async () => {
    const settings = DraftSettings.parse({
      taxonomyId: 1063,
      quantity: 10,
      shippingProfileId: 7001,
      readinessStateId: 8001,
    });
    const made = await drafts.createDraftFromProject(maker, {
      projectId: PROJECT,
      destinationId: "etsy",
      settings,
      requestKey: "key-1",
      by: "Drafts page",
    });
    expect(made).toMatchObject({
      photos: 2,
      missingPhotos: [],
      readBack: [],
    });
    expect(made.editorUrl).toContain(String(made.listingId));
    await expect(
      drafts.createDraftFromProject(maker, {
        projectId: PROJECT,
        destinationId: "etsy",
        settings,
        requestKey: "key-1",
        by: "Drafts page",
      }),
    ).rejects.toThrow("already sent");
    const creates = writes().filter(
      (c) => c.init?.method === "POST" && c.url.pathname.endsWith("/listings"),
    );
    expect(creates).toHaveLength(1);
    const log = await drafts.draftLog(maker, made.listingId);
    expect(log.map((l) => [l.action, l.status])).toEqual([
      ["photos", "done"],
      ["create", "done"],
    ]);
    expect(await drafts.projectDrafts(maker, PROJECT)).toEqual([
      {
        destinationId: "etsy",
        listingId: made.listingId,
        at: expect.any(String),
      },
    ]);
    // The next preview starts from what this draft used.
    const next = await drafts.previewDraft(maker, PROJECT, "etsy");
    expect(next.settings.taxonomyId).toBe(1063);
    expect(next.made.map((m) => m.listingId)).toEqual([made.listingId]);
  });

  it("sends again a draft Etsy refused: nothing was made, its key is free", async () => {
    const maker = await getCurrentMaker();
    let refusals = 1;
    failing = (method, path) =>
      method === "POST" && path.endsWith("/listings") && refusals-- > 0
        ? new Response(
            JSON.stringify({
              error: "A readiness_state_id is required for physical listings.",
            }),
            { status: 400 },
          )
        : undefined;
    const send = () =>
      drafts.createDraftFromProject(maker, {
        projectId: PROJECT,
        destinationId: "etsy",
        settings: DraftSettings.parse({
          taxonomyId: 1063,
          quantity: 10,
          shippingProfileId: 7001,
          readinessStateId: 8001,
        }),
        requestKey: "key-5",
        by: "Drafts page",
      });
    await expect(send()).rejects.toThrow(
      "Etsy said: A readiness_state_id is required",
    );
    const made = await send();
    expect(made.photos).toBe(2);
    await expect(send()).rejects.toThrow("already sent");
    const rows = await db.shopWrite.findMany({
      where: { makerId: maker.id, requestKey: "key-5" },
    });
    expect(rows.map((r) => [r.status, r.listingId])).toEqual([
      ["done", String(made.listingId)],
    ]);
  });

  it("sends the item's weight and packed size with a calculated shipping profile", async () => {
    const settings = {
      taxonomyId: 1063,
      quantity: 10,
      shippingProfileId: 7002,
      readinessStateId: 8001,
    };
    const send = (extra: object, requestKey: string) =>
      drafts.createDraftFromProject(maker, {
        projectId: PROJECT,
        destinationId: "etsy",
        settings: DraftSettings.parse({ ...settings, ...extra }),
        requestKey,
        by: "Drafts page",
      });
    await expect(send({}, "key-6")).rejects.toThrow(
      "Add the item's weight and packed size",
    );
    expect(writes()).toEqual([]);
    await send(
      {
        weight: { value: 3, unit: "oz" },
        size: { length: 7, width: 5, height: 1, unit: "in" },
      },
      "key-7",
    );
    const create = writes().find(
      (c) => c.init?.method === "POST" && c.url.pathname.endsWith("/listings"),
    );
    expect(await sentBody(create?.init)).toMatchObject({
      shipping_profile_id: "7002",
      item_weight: "3",
      item_weight_unit: "oz",
      item_length: "7",
      item_width: "5",
      item_height: "1",
      item_dimensions_unit: "in",
    });
  });

  it("never sends a create again when Etsy did not answer", async () => {
    const maker = await getCurrentMaker();
    failing = (method, path) =>
      method === "POST" && path.endsWith("/listings")
        ? new Response("", { status: 502 })
        : undefined;
    await expect(
      drafts.createDraftFromProject(maker, {
        projectId: PROJECT,
        destinationId: "etsy",
        settings: DraftSettings.parse({
          taxonomyId: 1063,
          quantity: 10,
          shippingProfileId: 7001,
          readinessStateId: 8001,
        }),
        requestKey: "key-2",
        by: "Board",
      }),
    ).rejects.toThrow("Etsy did not answer: look in your drafts");
    expect(writes()).toHaveLength(1);
    const row = await db.shopWrite.findFirstOrThrow({
      where: { makerId: maker.id, requestKey: "key-2" },
    });
    expect(row.status).toBe("unanswered");
  });

  it("keeps the draft when a photo does not go through, and sends it again", async () => {
    let refused = 0;
    failing = (method, path) =>
      method === "POST" && path.endsWith("/images") && refused++ === 0
        ? new Response(JSON.stringify({ error: "Image too large" }), {
            status: 400,
          })
        : undefined;
    const made = await drafts.createDraftFromProject(maker, {
      projectId: PROJECT,
      destinationId: "etsy",
      settings: DraftSettings.parse({
        taxonomyId: 1063,
        quantity: 10,
        shippingProfileId: 7001,
        readinessStateId: 8001,
      }),
      requestKey: "key-3",
      by: "Drafts page",
    });
    expect(made.missingPhotos).toEqual(["01-colours.jpg"]);
    expect(made.readBack).toEqual([]);
    const again = await drafts.sendMissingPhotos(
      maker,
      made.listingId,
      "Drafts page",
    );
    expect(again).toEqual({ sent: 1, missing: [] });
    expect(
      (await drafts.draftDetail(maker, made.listingId)).images,
    ).toHaveLength(2);
  });

  it("changes nothing on a live listing: no write reaches Etsy", async () => {
    for (const run of [
      () => drafts.updateDraft(maker, LIVE, { title: "Live" }, "Chat"),
      () => drafts.updateDraft(maker, LIVE, { price: 1 }, "Chat"),
      () => drafts.removeDraftPhoto(maker, LIVE, 1, "Chat"),
      () =>
        drafts.addDraftPhoto(
          maker,
          LIVE,
          { bytes: new Uint8Array([1]), mime: "image/jpeg", filename: "a.jpg" },
          "Chat",
        ),
    ]) {
      await expect(run()).rejects.toThrow("Kiln changes drafts only");
    }
    expect(writes()).toEqual([]);
    const detail = await drafts.draftDetail(maker, LIVE);
    expect(detail).toMatchObject({ editable: false, state: "active" });
  });

  it("keeps a draft's variations: its price is not rewritten, its text not touched", async () => {
    await expect(
      drafts.updateDraft(
        maker,
        VARIED,
        { title: "Tote", price: 40 },
        "Drafts page",
      ),
    ).rejects.toThrow("has variations");
    expect(writes()).toEqual([]);
    expect((await drafts.draftDetail(maker, VARIED)).variations).toBe(true);
  });

  it("sends only what changed, logs it, and reads it back", async () => {
    const result = await drafts.updateDraft(
      maker,
      PLAIN,
      {
        title: "Hand-lettered Recipe Card, Set of 4",
        tags: ["handmade gift"],
        price: 22,
      },
      "Drafts page",
    );
    expect(result.changes.map((c) => c.field)).toEqual(["title", "price"]);
    expect(result.readBack).toEqual([]);
    const sent = await Promise.all(writes().map((c) => sentBody(c.init)));
    expect(sent[0]).toEqual({ title: "Hand-lettered Recipe Card, Set of 4" });
    expect(sent[1]).toMatchObject({
      products: [{ offerings: [{ price: 22, quantity: 5 }] }],
    });
    expect((await drafts.draftLog(maker, PLAIN)).map((l) => l.action)).toEqual([
      "price",
      "edit",
    ]);
  });

  it("adds and removes a draft's photo", async () => {
    await drafts.addDraftPhoto(
      maker,
      PLAIN,
      {
        bytes: new Uint8Array([255, 216]),
        mime: "image/jpeg",
        filename: "b.jpg",
      },
      "Drafts page",
    );
    const detail = await drafts.draftDetail(maker, PLAIN);
    expect(detail.images).toHaveLength(2);
    await drafts.removeDraftPhoto(
      maker,
      PLAIN,
      detail.images[0].id,
      "Drafts page",
    );
    expect((await drafts.draftDetail(maker, PLAIN)).images).toHaveLength(1);
    await expect(
      drafts.removeDraftPhoto(maker, PLAIN, 999, "Drafts page"),
    ).rejects.toThrow("not on this draft");
  });

  it("never sent a listing's state in any of these writes", async () => {
    await drafts.updateDraft(
      maker,
      PLAIN,
      { description: "New words." },
      "Chat",
    );
    await drafts.createDraftFromProject(maker, {
      projectId: PROJECT,
      destinationId: "etsy",
      settings: DraftSettings.parse({
        taxonomyId: 1063,
        quantity: 3,
        shippingProfileId: 7001,
        readinessStateId: 8001,
      }),
      requestKey: "key-4",
      by: "Chat",
    });
    const bodies = await Promise.all(writes().map((c) => sentBody(c.init)));
    expect(bodies.length).toBeGreaterThan(2);
    for (const body of bodies) expect(body).not.toHaveProperty("state");
  });
});

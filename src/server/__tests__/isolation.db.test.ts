import { createHash, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { etsyFetch } from "@/server/__fixtures__/etsy-fetch";
import type { KilnMessage } from "@/server/chat/messages";
import type { CurrentMaker } from "@/server/maker-repository";

// Two studios on one database (the throwaway Postgres: see
// project-repository.db.test.ts): each with a row of everything a maker
// owns, and neither reads or changes the other's. It covers the functions
// and routes named here by hand; a function added later is caught by
// maker-scope.test.ts, not by this file.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

// Storage is stubbed (named by the bytes, like the real one).
vi.mock("@/providers/asset-bytes", async (original) => ({
  ...(await original<typeof import("@/providers/asset-bytes")>()),
  storeAsset: async (bytes: Uint8Array, mime: string, prefix: string) =>
    `https://storage.test/${prefix}/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${mime.split("/")[1]}`,
}));

// Etsy is set up, and answered by the mock shop through a stubbed fetch.
vi.mock("@/lib/env", async (original) => {
  const real = await original<typeof import("@/lib/env")>();
  return {
    env: {
      ...real.env,
      ETSY_API_KEY: "kstr",
      ETSY_SHARED_SECRET: "shh",
      ETSY_REDIRECT_URI: "https://localhost:3009/api/shops/etsy/callback",
    },
  };
});

// No request is being served, as Next says it, unless a case sets one.
const served = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!served.headers) {
      throw new Error("`headers` was called outside a request scope.");
    }
    return served.headers;
  },
}));

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface Studio {
  label: string;
  maker: CurrentMaker;
  organizationId: string;
  email: string;
  sku: string;
  productId: string;
  projectId: string;
  projectName: string;
  designId: string;
  batchId: string;
  doneJobId: string;
  queuedJobId: string;
  output: string;
  costMicros: number;
  queuedMicros: number;
  sessionId: string;
  lessonId: string;
  signalId: string;
  token: string;
  tokenId: string;
  quoteId: string;
  toolCallId: string;
  keyHint: string;
}

describe.skipIf(!enabled)("two studios on one database", async () => {
  const { db } = await import("@/lib/db");
  const products = await import("@/server/product-repository");
  const projects = await import("@/server/project-repository");
  const designs = await import("@/server/designs");
  const chat = await import("@/server/chat/chat-repository");
  const lessons = await import("@/server/lessons");
  const tokens = await import("@/server/access-tokens");
  const { newToken } = await import("@/server/token-format");
  const { recentToolCalls } = await import("@/server/tool-calls");
  const drafts = await import("@/server/etsy-drafts");
  const shops = await import("@/server/shop-connection");
  const keys = await import("@/server/provider-keys");
  const { listTeam } = await import("@/server/team");
  const { homeStats } = await import("@/server/home-repository");
  const generation = await import("@/server/generation-repository");
  const { monthLimit } = await import("@/server/month-limit");
  const quotes = await import("@/server/spend-quotes");
  const pricing = await import("@/modules/laser-pricing/repository");
  const { DEFAULT_SHOP } = await import("@/modules/laser-pricing/presets");
  const { getCurrentMaker, getRequestMaker } = await import(
    "@/server/maker-repository"
  );
  const { mockEtsy, MOCK_SHOP_ID } = await import("@/providers/shop/etsy-mock");
  const { mockEtsyDrafts, newMockDraftStore } = await import(
    "@/providers/shop/etsy-drafts-mock"
  );
  const { planProject } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { MarketBrief } = await import("@/domain/market-brief");
  const { CATALOG } = await import("@/lib/recipes");
  const { photoReference, startEditorState } = await import(
    "@/lib/project-start"
  );
  const projectsRoute = await import("@/app/api/projects/route");
  const framesRoute = await import("@/app/api/projects/[id]/frames/route");
  const approvalRoute = await import(
    "@/app/api/projects/[id]/frames/[destinationId]/[slotKey]/approval/route"
  );
  const referenceRoute = await import(
    "@/app/api/projects/[id]/reference/route"
  );
  const resultsRoute = await import(
    "@/app/api/projects/[id]/results/[destinationId]/[read]/route"
  );
  const swatchRoute = await import(
    "@/app/api/products/[id]/colours/[key]/swatch/route"
  );

  // The mock shop's two drafts. Both studios connect the same shop, so a
  // listing's number alone never tells them apart.
  const PLAIN = MOCK_SHOP_ID * 1000 + 501;
  const VARIED = MOCK_SHOP_ID * 1000 + 502;
  const NO_LISTING = 999_999_999;
  const HERO = { destinationId: "etsy", slotKey: "hero" };

  const makers: string[] = [];
  const organizations: string[] = [];
  const users: string[] = [];
  let a: Studio;
  let b: Studio;

  const now = Date.now();
  const etsy = etsyFetch(
    mockEtsy(() => new Date(now)),
    ["a", "b"].map((label) => ({
      body: {
        access_token: `90001.access-${label}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `90001.refresh-${label}`,
      },
    })),
    { drafts: mockEtsyDrafts({ store: newMockDraftStore() }) },
  );
  // Only while a case talks to the shop: nothing else here fetches.
  const withShop = async <T>(work: () => Promise<T>): Promise<T> => {
    vi.stubGlobal("fetch", etsy.fetch);
    try {
      return await work();
    } finally {
      vi.unstubAllGlobals();
    }
  };

  const request = (label: string) => ({
    kind: "image" as const,
    masterAssetUrl: "https://stub.local/plate.png",
    prompt: `a scene for studio ${label}`,
    imageInputs: [],
    negative: "",
    model: {
      provider: "openai" as const,
      model: "gpt-image-2",
      aspect: "1:1",
      guidance: 7.5,
      strength: 0.65,
    },
  });

  async function openStudio(
    label: "a" | "b",
    costMicros: number,
    queuedMicros: number,
  ): Promise<Studio> {
    const run = randomUUID();
    const userId = randomUUID();
    const email = `${userId}@kiln.test`;
    await db.user.create({
      data: { id: userId, name: `Owner ${label}`, email },
    });
    users.push(userId);
    const organizationId = randomUUID();
    await db.organization.create({
      data: {
        id: organizationId,
        name: `Studio ${label} ${run}`,
        slug: `iso-${label}-${run}`,
        createdAt: new Date(),
      },
    });
    organizations.push(organizationId);
    const row = await db.maker.create({
      data: {
        slug: `iso-${label}-${run}`,
        name: `Studio ${label}`,
        organizationId,
      },
      select: { id: true, slug: true, name: true },
    });
    makers.push(row.id);
    const memberId = randomUUID();
    await db.member.create({
      data: {
        id: memberId,
        organizationId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const maker: CurrentMaker = {
      ...row,
      member: { id: memberId, userId, role: "owner" },
    };

    const sku = `ISO-${label}-${run}`;
    const [product] = await products.upsertProducts(maker, [
      Product.parse({
        id: `pkg:${sku}`,
        sku,
        name: `Studio ${label} coaster`,
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
      type: "listing-kit",
      destinationIds: ["etsy"],
      catalog: CATALOG,
    });
    const projectId = await projects.createProject(maker, {
      type: "listing-kit",
      product,
      plan,
      editor: startEditorState({ product, type: "listing-kit", plan, master }),
    });
    const projectName = `Studio ${label} kit ${run}`;
    await projects.renameProject(maker, projectId, projectName);
    await projects.setBrief(
      maker,
      projectId,
      "etsy",
      MarketBrief.parse({
        searches: [
          {
            term: `studio ${label} search`,
            source: "test",
            readOn: "2026-11-01",
          },
        ],
      }),
    );
    const output = `https://stub.local/${run}/hero.png`;
    await db.card.update({
      where: { projectId_cardId: { projectId, cardId: "etsy.hero" } },
      data: { outputs: [output], status: "done" },
    });
    const design = await db.project.create({
      data: {
        makerId: maker.id,
        name: `Studio ${label} design ${run}`,
        type: "design",
        phase: "generation",
      },
      select: { id: true },
    });

    const session = await db.chatSession.create({
      data: { makerId: maker.id, projectId, title: `Studio ${label} chat` },
      select: { id: true },
    });
    await chat.saveChatMessages(maker, session.id, [
      {
        id: "first",
        role: "user",
        parts: [{ type: "text", text: `hello from studio ${label}` }],
      },
    ]);

    // A batch with a finished take and a job still waiting; the waiting one
    // is not due for a month, so no worker of another test claims it.
    const batch = await db.generationBatch.create({
      data: {
        makerId: maker.id,
        projectId,
        mode: "live",
        count: 2,
        estimateMicros: 70_000 + queuedMicros,
        model: "gpt-image-2",
      },
      select: { id: true },
    });
    const job = {
      makerId: maker.id,
      projectId,
      batchId: batch.id,
      mode: "live",
      maxAttempts: 2,
      request: request(label),
      sessionId: session.id,
      memberId,
    };
    const done = await db.generationJob.create({
      data: {
        ...job,
        cardId: "etsy.hero",
        status: "done",
        estimateMicros: 70_000,
        actualMicros: costMicros,
        outputUrl: output,
        finishedAt: new Date(),
        productHash: `hash-${label}`,
      },
      select: { id: true },
    });
    const queued = await db.generationJob.create({
      data: {
        ...job,
        cardId: "iso.waiting",
        status: "queued",
        estimateMicros: queuedMicros,
        availableAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    const lesson = await db.lesson.create({
      data: {
        makerId: maker.id,
        key: `iso:${run}`,
        topic: "general",
        text: `Studio ${label} likes warm light.`,
        source: "agent",
        status: "kept",
      },
      select: { id: true },
    });
    const signal = await db.tasteSignal.create({
      data: {
        makerId: maker.id,
        projectId,
        family: "kitchen",
        destinationId: "etsy",
        slotKey: "hero",
        slotLabel: "Hero",
        kind: "approved",
        knob: "light",
        stop: "warm",
      },
      select: { id: true },
    });
    const made = await tokens.createAccessToken(maker, `Studio ${label}`);
    const quote = await quotes.createQuote(maker, {
      action: "generate",
      input: { projectId },
      typicalMicros: 50_000,
      maxMicros: 70_000,
      tokenId: made.created.id,
    });
    const call = await db.toolCall.create({
      data: {
        makerId: maker.id,
        tokenId: made.created.id,
        tokenName: `Studio ${label}`,
        tool: `studio_${label}_tool`,
        args: {},
        ok: true,
        ms: 1,
      },
      select: { id: true },
    });
    const keyHint = label === "a" ? "AAAA" : "BBBB";
    await keys.saveProviderKey(
      maker.id,
      "openai",
      `sk-isolation-test-key-${keyHint}`,
    );
    await pricing.saveMakerPricing(maker, {
      machineName: `Studio ${label} machine`,
      materialName: "Birch",
      shop: DEFAULT_SHOP,
    });

    // The shop, through the real handshake; then what Kiln sent it.
    await withShop(async () => {
      const { url, cookie } = shops.beginConnect(now);
      await shops.finishConnect(maker, {
        code: "the-code",
        state: new URL(url).searchParams.get("state"),
        cookie,
        now,
      });
    });
    await db.shopConnection.update({
      where: { makerId_platform: { makerId: maker.id, platform: "etsy" } },
      data: { shopName: `Studio ${label} shop` },
    });
    const sent = (listingId: number) => ({
      makerId: maker.id,
      platform: "etsy",
      shopId: String(MOCK_SHOP_ID),
      listingId: String(listingId),
      action: "create",
      projectId,
      destinationId: "etsy",
      productId: product.id,
      sent: { title: `Studio ${label} draft` },
      by: "Drafts page",
      status: "done",
    });
    await db.shopWrite.create({ data: sent(PLAIN) });
    // Only studio B made the second draft.
    if (label === "b") await db.shopWrite.create({ data: sent(VARIED) });

    return {
      label,
      maker,
      organizationId,
      email,
      sku,
      productId: product.id,
      projectId,
      projectName,
      designId: design.id,
      batchId: batch.id,
      doneJobId: done.id,
      queuedJobId: queued.id,
      output,
      costMicros,
      queuedMicros,
      sessionId: session.id,
      lessonId: lesson.id,
      signalId: signal.id,
      token: made.token,
      tokenId: made.created.id,
      quoteId: quote.id,
      toolCallId: call.id,
      keyHint,
    };
  }

  beforeAll(async () => {
    a = await openStudio("a", 61_000, 50_000);
    b = await openStudio("b", 97_000, 30_000);
    // A second key only studio B holds.
    await keys.saveProviderKey(
      b.maker.id,
      "google",
      "AIza-isolation-test-GGGG",
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    const makerId = { in: makers };
    await db.generationJob.deleteMany({ where: { makerId } });
    await db.generationBatch.deleteMany({ where: { makerId } });
    await db.spendQuote.deleteMany({ where: { makerId } });
    await db.toolCall.deleteMany({ where: { makerId } });
    // A project takes its cards, its anchor, its products' links and its
    // conversations with it.
    await db.project.deleteMany({ where: { makerId } });
    await db.product.deleteMany({ where: { makerId } });
    // A maker takes its tokens, lessons, signals, shop, keys, writes and
    // settings with it.
    await db.maker.deleteMany({ where: { id: makerId } });
    await db.organization.deleteMany({ where: { id: { in: organizations } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });

  // Every row of a studio, to compare before and after another studio's try.
  const rowsOf = async (s: Studio) => {
    const where = { makerId: s.maker.id };
    const byId = { orderBy: { id: "asc" as const } };
    return {
      maker: await db.maker.findUnique({ where: { id: s.maker.id } }),
      team: await db.member.findMany({
        where: { organizationId: s.organizationId },
        ...byId,
      }),
      products: await db.product.findMany({ where, ...byId }),
      projects: await db.project.findMany({
        where,
        ...byId,
        include: {
          master: true,
          cards: { orderBy: { cardId: "asc" } },
          products: true,
        },
      }),
      batches: await db.generationBatch.findMany({ where, ...byId }),
      jobs: await db.generationJob.findMany({ where, ...byId }),
      chats: await db.chatSession.findMany({
        where,
        ...byId,
        include: { messages: { orderBy: { seq: "asc" } } },
      }),
      lessons: await db.lesson.findMany({ where, ...byId }),
      signals: await db.tasteSignal.findMany({ where, ...byId }),
      tokens: await db.accessToken.findMany({ where, ...byId }),
      quotes: await db.spendQuote.findMany({ where, ...byId }),
      calls: await db.toolCall.findMany({ where, ...byId }),
      shops: await db.shopConnection.findMany({ where, ...byId }),
      keys: await db.providerKey.findMany({
        where,
        orderBy: { provider: "asc" },
      }),
      writes: await db.shopWrite.findMany({ where, ...byId }),
      settings: await db.moduleSettings.findMany({ where }),
    };
  };

  const missing = () => `missing-${randomUUID()}`;

  // How a call ended, with the ids it was given taken out of its words.
  const outcome = async (run: () => Promise<unknown>, ...ids: string[]) => {
    let ended: unknown;
    try {
      ended = { answered: (await run()) ?? null };
    } catch (error) {
      ended = {
        refused: error instanceof Error ? error.message : String(error),
        kind: error instanceof Error ? error.constructor.name : null,
        code: (error as { code?: string }).code ?? null,
      };
    }
    return JSON.parse(
      ids.reduce(
        (text, id) => text.replaceAll(id, "<id>"),
        JSON.stringify(ended),
      ),
    ) as { answered?: unknown; refused?: string };
  };

  // As studio A, another studio's id is answered exactly as an id nobody has.
  const asUnknown = async (
    run: (id: string) => Promise<unknown>,
    theirs: string,
  ) => {
    const unknown = missing();
    const got = await outcome(() => run(theirs), theirs);
    expect(got).toEqual(await outcome(() => run(unknown), unknown));
    return got;
  };

  // The same, and studio B's rows are as they were.
  const changesNothing = async (
    run: (id: string) => Promise<unknown>,
    theirs: string,
  ) => {
    const before = await rowsOf(b);
    const got = await asUnknown(run, theirs);
    expect(await rowsOf(b)).toEqual(before);
    return got;
  };

  it("each studio has a row of everything a maker owns", async () => {
    for (const s of [a, b]) {
      const rows = await rowsOf(s);
      expect(rows.maker).toMatchObject({
        id: s.maker.id,
        organizationId: s.organizationId,
      });
      expect(rows.team).toMatchObject([{ role: "owner" }]);
      expect(rows.products.map((r) => r.id)).toEqual([s.productId]);
      expect(rows.projects.map((r) => r.id).sort()).toEqual(
        [s.projectId, s.designId].sort(),
      );
      const kit = rows.projects.find((r) => r.id === s.projectId);
      expect(kit?.cards.length).toBeGreaterThan(0);
      expect(kit?.master).not.toBeNull();
      expect(kit?.products.map((r) => r.productId)).toEqual([s.productId]);
      expect(rows.batches.map((r) => r.id)).toEqual([s.batchId]);
      expect(rows.jobs.map((r) => r.id).sort()).toEqual(
        [s.doneJobId, s.queuedJobId].sort(),
      );
      expect(rows.chats.map((r) => r.id)).toEqual([s.sessionId]);
      expect(rows.chats[0].messages).toHaveLength(1);
      expect(rows.lessons.map((r) => r.id)).toEqual([s.lessonId]);
      expect(rows.signals.map((r) => r.id)).toEqual([s.signalId]);
      expect(rows.tokens.map((r) => r.id)).toEqual([s.tokenId]);
      expect(rows.quotes.map((r) => r.id)).toEqual([s.quoteId]);
      expect(rows.calls.map((r) => r.id)).toEqual([s.toolCallId]);
      expect(rows.shops).toHaveLength(1);
      expect(rows.keys.length).toBeGreaterThan(0);
      expect(rows.writes.length).toBeGreaterThan(0);
      expect(rows.settings).toHaveLength(1);
    }
  });

  describe("a list holds the studio's own rows and none of the other's", () => {
    it("products, projects, designs and the briefs kept for a product", async () => {
      expect((await products.listProducts(a.maker)).map((p) => p.id)).toEqual([
        a.productId,
      ]);
      expect(
        (await projects.listProjects(a.maker)).map((p) => p.id).sort(),
      ).toEqual([a.projectId, a.designId].sort());
      expect((await designs.listDesigns(a.maker)).map((d) => d.id)).toEqual([
        a.designId,
      ]);
      const briefs = await projects.latestBriefs(a.maker, a.productId);
      expect(briefs.etsy).toMatchObject({
        projectName: a.projectName,
        brief: { searches: [{ term: "studio a search" }] },
      });
      expect(JSON.stringify(briefs)).not.toContain("studio b search");
    });

    it("conversations, lessons, access tokens and tool calls", async () => {
      expect((await chat.listChatSessions(a.maker)).map((s) => s.id)).toEqual([
        a.sessionId,
      ]);
      expect(
        (await chat.listChatSessions(a.maker, { projectId: b.projectId })).map(
          (s) => s.id,
        ),
      ).toEqual([]);
      expect((await lessons.listLessons(a.maker)).map((l) => l.id)).toEqual([
        a.lessonId,
      ]);
      expect(
        (await lessons.keptLessons(a.maker, null, null)).map((l) => l.id),
      ).toEqual([a.lessonId]);
      expect((await tokens.listAccessTokens(a.maker)).map((t) => t.id)).toEqual(
        [a.tokenId],
      );
      expect((await recentToolCalls(a.maker)).map((c) => c.id)).toEqual([
        a.toolCallId,
      ]);
    });

    it("the shop's drafts name only the studio's own projects", async () => {
      const listed = await withShop(() => drafts.listDrafts(a.maker));
      expect(listed.shopName).toBe("Studio a shop");
      expect(listed.drafts.map((d) => d.listingId).sort()).toEqual([
        PLAIN,
        VARIED,
      ]);
      // Both studios made the first draft: A reads its own project on it.
      expect(listed.drafts.find((d) => d.listingId === PLAIN)?.madeBy).toEqual({
        projectId: a.projectId,
        projectName: a.projectName,
      });
      // Only B made the second: to A, Kiln made it from nothing.
      expect(
        listed.drafts.find((d) => d.listingId === VARIED)?.madeBy,
      ).toBeUndefined();
      const text = JSON.stringify(listed);
      expect(text).not.toContain(b.projectId);
      expect(text).not.toContain(b.projectName);
    });

    it("provider keys and the team", async () => {
      const states = await keys.providerKeyStates(a.maker.id);
      expect(states.find((s) => s.provider === "openai")?.hint).toBe("AAAA");
      // B saved a second key; A has none of that provider.
      expect(states.find((s) => s.provider === "google")?.hint).toBeNull();
      const team = await listTeam(a.maker);
      expect(team.members.map((m) => m.email)).toEqual([a.email]);
      expect(team.members[0]).toMatchObject({ role: "owner", you: true });
      expect(JSON.stringify(team)).not.toContain(b.email);
    });

    it("this month's spend counts only the studio's own work, whatever the other spent", async () => {
      const stats = await homeStats(a.maker.id);
      expect([...stats.projects.keys()]).toEqual([a.projectId]);
      expect(stats.projects.get(a.projectId)?.spentMicros).toBe(a.costMicros);
      expect(await generation.spendByMember(a.maker)).toEqual([
        { memberId: a.maker.member?.id, spentMicros: a.costMicros },
      ]);
      expect(await generation.sessionSpend(a.maker.id, a.sessionId)).toEqual({
        spentMicros: a.costMicros,
        queuedMicros: a.queuedMicros,
      });
      expect(await generation.budget(a.maker.id)).toMatchObject({
        spentMicros: a.costMicros,
        reservedMicros: a.queuedMicros,
      });
      expect(await monthLimit(a.maker)).toMatchObject({
        whose: "studio",
        spentMicros: a.costMicros,
        reservedMicros: a.queuedMicros,
      });
      // And the other way round: B's own, not the two together.
      expect(await generation.budget(b.maker.id)).toMatchObject({
        spentMicros: b.costMicros,
        reservedMicros: b.queuedMicros,
      });
    });
  });

  describe("a lookup with the other studio's id answers as for an id nobody has", () => {
    it("a product, by its id or its sku, and the projects that use it", async () => {
      expect(
        await asUnknown((id) => products.getProduct(a.maker, id), b.productId),
      ).toEqual({ answered: null });
      expect(
        await asUnknown((id) => products.findProduct(a.maker, id), b.productId),
      ).toEqual({ answered: null });
      expect(
        await asUnknown((sku) => products.findProduct(a.maker, sku), b.sku),
      ).toEqual({ answered: null });
      expect(
        await asUnknown(
          (id) => products.productProjects(a.maker, id),
          b.productId,
        ),
      ).toEqual({ answered: [] });
      expect(
        await asUnknown(
          (id) => projects.latestBriefs(a.maker, id),
          b.productId,
        ),
      ).toEqual({ answered: {} });
      // Its own it reads.
      expect((await products.getProduct(a.maker, a.productId))?.sku).toBe(
        a.sku,
      );
    });

    it("a project, its board, a design and its generation state", async () => {
      expect(
        await asUnknown((id) => projects.loadProject(a.maker, id), b.projectId),
      ).toEqual({ answered: null });
      expect(
        await asUnknown(
          (id) => projects.loadProjectBoard(a.maker, id),
          b.projectId,
        ),
      ).toEqual({ answered: null });
      expect(
        await asUnknown((id) => designs.designView(a.maker, id), b.designId),
      ).toEqual({ answered: null });
      const state = await asUnknown(
        (id) => generation.projectGenerationState(a.maker.id, id),
        b.projectId,
      );
      expect(state.answered).toMatchObject({
        jobs: {},
        cards: {},
        batch: null,
      });
      // Its own it reads.
      expect(
        (await projects.loadProjectBoard(a.maker, a.projectId))?.board.id,
      ).toBe(a.projectId);
      expect((await designs.designView(a.maker, a.designId))?.project.id).toBe(
        a.designId,
      );
      const own = await generation.projectGenerationState(
        a.maker.id,
        a.projectId,
      );
      expect(own.jobs["etsy.hero"]).toMatchObject({ status: "done" });
      expect(own.batch?.batchId).toBe(a.batchId);
    });

    it("a conversation, and what it spent", async () => {
      expect(
        await asUnknown((id) => chat.getChat(a.maker, id), b.sessionId),
      ).toEqual({ answered: null });
      expect(
        await asUnknown((id) => chat.chatOwned(a.maker, id), b.sessionId),
      ).toEqual({ answered: false });
      expect(
        await asUnknown(
          (id) => generation.sessionSpend(a.maker.id, id),
          b.sessionId,
        ),
      ).toEqual({ answered: { spentMicros: 0, queuedMicros: 0 } });
      expect((await chat.getChat(a.maker, a.sessionId))?.messages).toHaveLength(
        1,
      );
    });

    it("a draft's log holds only what the studio itself sent", async () => {
      // B alone wrote to the second draft: A's log of it is as empty as the
      // log of a listing nobody wrote to.
      expect(await drafts.draftLog(a.maker, VARIED)).toEqual([]);
      expect(await drafts.draftLog(a.maker, NO_LISTING)).toEqual([]);
      const detail = await withShop(() => drafts.draftDetail(a.maker, VARIED));
      expect(detail.log).toEqual([]);
      expect(detail.madeBy).toBeUndefined();
      // Both wrote to the first: A reads its own line of it, once.
      const own = await drafts.draftLog(a.maker, PLAIN);
      expect(own.map((w) => w.sent)).toEqual([{ title: "Studio a draft" }]);
      expect(
        (await drafts.draftLog(b.maker, VARIED)).map((w) => w.sent),
      ).toEqual([{ title: "Studio b draft" }]);
    });

    it("the studio's own pricing defaults and its own shop", async () => {
      expect((await pricing.getMakerPricing(a.maker))?.machineName).toBe(
        "Studio a machine",
      );
      expect((await pricing.getMakerPricing(b.maker))?.machineName).toBe(
        "Studio b machine",
      );
      expect((await shops.shopConnection(a.maker))?.shopName).toBe(
        "Studio a shop",
      );
      expect((await shops.shopConnection(b.maker))?.shopName).toBe(
        "Studio b shop",
      );
    });
  });

  describe("a write with the other studio's id changes nothing of theirs", () => {
    it("a product is neither saved over nor deleted", async () => {
      const mine = await products.getProduct(a.maker, a.productId);
      if (!mine) throw new Error("studio A has no product");
      const saved = await changesNothing(
        (id) =>
          products.updateProduct(a.maker, id, { ...mine, name: "Taken over" }),
        b.productId,
      );
      expect(saved.refused).toBe("That product no longer exists.");
      const deleted = await changesNothing(
        (id) => products.deleteProduct(a.maker, id),
        b.productId,
      );
      expect(deleted.refused).toBe("That product no longer exists.");
    });

    it("a project is neither renamed nor deleted, and its queue is not canceled", async () => {
      const renamed = await changesNothing(
        (id) => projects.renameProject(a.maker, id, "Taken over"),
        b.projectId,
      );
      expect(renamed.refused).toBeDefined();
      const deleted = await changesNothing(
        (id) => projects.deleteProject(a.maker, id),
        b.projectId,
      );
      expect(deleted.refused).toBeDefined();
      expect(
        await changesNothing(
          (id) => generation.cancelBatch(a.maker.id, id),
          b.batchId,
        ),
      ).toEqual({ answered: 0 });
      const waiting = await db.generationJob.findFirst({
        where: { id: b.queuedJobId, makerId: b.maker.id },
        select: { status: true },
      });
      expect(waiting?.status).toBe("queued");
    });

    it("a frame is not approved and a brief is not saved", async () => {
      const approved = await changesNothing(
        (id) => projects.setSlotApproval(a.maker, id, HERO, true),
        b.projectId,
      );
      expect(approved.refused).toBe("project not found");
      const brief = await changesNothing(
        (id) =>
          projects.setBrief(
            a.maker,
            id,
            "etsy",
            MarketBrief.parse({
              searches: [
                { term: "taken over", source: "test", readOn: "2026-11-01" },
              ],
            }),
          ),
        b.projectId,
      );
      expect(brief.refused).toBe("project not found");
    });

    it("a conversation takes no message and no lock", async () => {
      const message: KilnMessage = {
        id: "intruder",
        role: "user",
        parts: [{ type: "text", text: "hello from studio a" }],
      };
      const saved = await changesNothing(
        (id) => chat.saveChatMessages(a.maker, id, [message]),
        b.sessionId,
      );
      expect(saved.refused).toBe("That conversation no longer exists.");
      expect(
        await changesNothing((id) => chat.lockChat(a.maker, id), b.sessionId),
      ).toEqual({ answered: { locked: false, stale: false } });
    });

    it("a lesson is not decided, a token neither revoked nor let spend, a quote not claimed", async () => {
      expect(
        await changesNothing(
          (id) => lessons.decideLesson(a.maker, id, "dismissed"),
          b.lessonId,
        ),
      ).toEqual({ answered: null });
      expect(
        await changesNothing(
          (id) => tokens.setTokenSpend(a.maker, id, true),
          b.tokenId,
        ),
      ).toEqual({ answered: false });
      expect(
        await changesNothing(
          (id) => tokens.revokeAccessToken(a.maker, id),
          b.tokenId,
        ),
      ).toEqual({ answered: false });
      const claimed = await changesNothing(
        (id) => quotes.claimQuote(a.maker, id, "generate"),
        b.quoteId,
      );
      expect(claimed.refused).toBe(
        "No quote of yours has that id: quote first.",
      );
    });

    it("removing a provider's key removes the studio's own and leaves the other's", async () => {
      const before = await rowsOf(b);
      // A provider only B has a key for.
      await keys.removeProviderKey(a.maker.id, "google");
      // A provider both have a key for.
      await keys.removeProviderKey(a.maker.id, "openai");
      expect(await rowsOf(b)).toEqual(before);
      expect(
        (await keys.providerKeyStates(b.maker.id)).map((s) => s.hint).sort(),
      ).toEqual(["BBBB", "GGGG"]);
      expect(
        (await keys.providerKeyStates(a.maker.id)).map((s) => s.hint),
      ).toEqual([null, null]);
      await keys.saveProviderKey(
        a.maker.id,
        "openai",
        "sk-isolation-test-key-AAAA",
      );
    });

    it("a change to a draft is logged for the studio that made it, never the other", async () => {
      const before = await rowsOf(b);
      await withShop(() =>
        drafts.updateDraft(
          a.maker,
          VARIED,
          { title: "Studio a retitled it" },
          "Drafts page",
        ),
      );
      expect(await rowsOf(b)).toEqual(before);
      expect(
        (await drafts.draftLog(a.maker, VARIED)).map((w) => w.action),
      ).toEqual(["edit"]);
      expect(
        (await drafts.draftLog(b.maker, VARIED)).map((w) => w.action),
      ).toEqual(["create"]);
    });
  });

  describe("an access token reaches only its own studio through the API", () => {
    const call = async (
      handler: (
        request: Request,
        context: { params: Promise<never> },
      ) => Promise<Response>,
      method: string,
      path: string,
      params: Record<string, string>,
      body?: { type: string; content: BodyInit },
    ) => {
      const response = await handler(
        new Request(`http://kiln.test${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${a.token}`,
            ...(body ? { "Content-Type": body.type } : {}),
          },
          ...(body ? { body: body.content } : {}),
        }),
        { params: Promise.resolve(params) as Promise<never> },
      );
      return { status: response.status, body: await response.text() };
    };

    // The same status and the same words for their id as for nobody's, and
    // their rows as they were.
    const sameAnswer = async (
      send: (id: string) => ReturnType<typeof call>,
      theirs: string,
      status: number,
    ) => {
      const before = await rowsOf(b);
      const unknown = missing();
      const got = await send(theirs);
      const none = await send(unknown);
      expect(got.status).toBe(status);
      expect({
        status: got.status,
        body: got.body.replaceAll(theirs, "<id>"),
      }).toEqual({
        status: none.status,
        body: none.body.replaceAll(unknown, "<id>"),
      });
      expect(await rowsOf(b)).toEqual(before);
    };

    it("GET /api/projects lists the token's studio's projects only", async () => {
      const response = await projectsRoute.GET(
        new Request("http://kiln.test/api/projects", {
          headers: { Authorization: `Bearer ${a.token}` },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { projects: { id: string }[] };
      expect(body.projects.map((p) => p.id)).toEqual([a.projectId]);
    });

    it("GET .../frames", async () => {
      await sameAnswer(
        (id) =>
          call(framesRoute.GET, "GET", `/api/projects/${id}/frames`, { id }),
        b.projectId,
        404,
      );
      const own = await call(
        framesRoute.GET,
        "GET",
        `/api/projects/${a.projectId}/frames`,
        { id: a.projectId },
      );
      expect(own.status).toBe(200);
      expect(JSON.parse(own.body).project.id).toBe(a.projectId);
    });

    it("PUT and DELETE .../approval", async () => {
      const params = (id: string) => ({ id, ...HERO });
      const path = (id: string) =>
        `/api/projects/${id}/frames/etsy/hero/approval`;
      await sameAnswer(
        (id) => call(approvalRoute.PUT, "PUT", path(id), params(id)),
        b.projectId,
        404,
      );
      await sameAnswer(
        (id) => call(approvalRoute.DELETE, "DELETE", path(id), params(id)),
        b.projectId,
        404,
      );
    });

    it("POST .../reference", async () => {
      await sameAnswer(
        (id) =>
          call(
            referenceRoute.POST,
            "POST",
            `/api/projects/${id}/reference`,
            { id },
            { type: "image/png", content: PNG },
          ),
        b.projectId,
        404,
      );
    });

    it("PUT .../results/:destinationId/:read", async () => {
      await sameAnswer(
        (id) =>
          call(
            resultsRoute.PUT,
            "PUT",
            `/api/projects/${id}/results/etsy/before`,
            { id, destinationId: "etsy", read: "before" },
            {
              type: "application/json",
              content: JSON.stringify({ visits: 3 }),
            },
          ),
        b.projectId,
        404,
      );
    });

    it("POST and DELETE .../swatch, by the product's id or its sku", async () => {
      const send = (method: "POST" | "DELETE") => (id: string) =>
        call(
          swatchRoute[method],
          method,
          `/api/products/${id}/colours/cork/swatch`,
          { id, key: "cork" },
          method === "POST" ? { type: "image/png", content: PNG } : undefined,
        );
      await sameAnswer(send("POST"), b.productId, 404);
      await sameAnswer(send("POST"), b.sku, 404);
      await sameAnswer(send("DELETE"), b.productId, 404);
      await sameAnswer(send("DELETE"), b.sku, 404);
    });
  });

  // The header a case sets must never reach another case: only this block
  // sets one, and takes it away after each.
  describe("the maker behind a request's access token", () => {
    afterEach(() => {
      served.headers = null;
    });
    const bearer = (token: string) => {
      served.headers = new Headers({ authorization: `Bearer ${token}` });
    };

    it("is the token's own studio, never the other", async () => {
      bearer(a.token);
      const { member: _member, ...makerA } = a.maker;
      expect(await getRequestMaker()).toEqual(makerA);
      expect(await getCurrentMaker()).toEqual(makerA);
      bearer(b.token);
      expect((await getRequestMaker())?.id).toBe(b.maker.id);
      expect((await getCurrentMaker()).slug).toBe(b.maker.slug);
    });

    it("is nobody for a token Kiln never made: no maker, and a refusal that says so", async () => {
      bearer(newToken().token);
      expect(await getRequestMaker()).toBeNull();
      await expect(getCurrentMaker()).rejects.toThrow(
        "That access token is not valid here.",
      );
    });

    it("is nobody once the header is gone", async () => {
      expect(await getRequestMaker()).toBeNull();
    });
  });
});

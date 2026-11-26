import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The free key check, as the provider would answer it: it rejects the one
// fixture key named below and accepts any other. No request goes out.
const REJECTED_SECRET = "sk-fixture-health-bob-rejected-01";
vi.mock("@/providers/key-check", async () => {
  const { providerKey } = await import("@/providers/keys");
  return {
    checkProviderKey: async (provider: "openai" | "google") =>
      providerKey(provider) === REJECTED_SECRET
        ? {
            ok: false,
            called: true,
            message:
              "OpenAI rejected the API key (401) — replace the key or use Google.",
          }
        : { ok: true, called: true, models: [] },
  };
});

// Against a migrated throwaway Postgres (see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("provider health (database)", async () => {
  const { db } = await import("@/lib/db");
  const { providerHealth } = await import("@/server/provider-health");
  const { CAP_REACHED } = await import("@/server/generation-worker");
  const { recordKeyCheck, budget, readUnlisted } = await import(
    "@/server/generation-repository"
  );
  const slug = `health-${Date.now()}`;
  let makerId = "";

  afterAll(async () => {
    if (!makerId) return;
    await db.generationJob.deleteMany({ where: { makerId } });
    await db.maker.delete({ where: { id: makerId } });
  });

  const row = (
    request: object,
    status: "done" | "failed",
    minutesAgo: number,
    error?: string,
  ) =>
    db.generationJob.create({
      data: {
        makerId,
        cardId: "direct",
        mode: "live",
        status,
        attempt: 1,
        maxAttempts: 1,
        estimateMicros: 1,
        request,
        error,
        finishedAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });

  it("shows a provider's last error until a later call succeeds; Kiln's own refusals are skipped", async () => {
    const maker = await db.maker.create({ data: { slug, name: "Health" } });
    makerId = maker.id;
    const google = {
      kind: "direct",
      provider: "google",
      model: "gemini-3.5-flash",
    };
    const openai = {
      kind: "image",
      model: { provider: "openai", model: "gpt-image-2" },
    };
    await row(google, "done", 60);
    await row(
      google,
      "failed",
      10,
      "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI.",
    );
    await row(openai, "failed", 30, "OpenAI is rate-limiting requests");
    await row(openai, "done", 5);
    await row(openai, "failed", 1, CAP_REACHED);

    const [o, g] = await providerHealth({ id: makerId });
    expect(g).toMatchObject({
      provider: "google",
      label: "Google",
      lastError: {
        message:
          "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI.",
      },
    });
    expect(g.lastOkAt).not.toBeNull();
    // A spend cap may pass; only a rejected key blocks the next call.
    expect(g.keyRejected).toBe(false);
    expect(o).toMatchObject({ provider: "openai", lastError: null });
    expect(typeof o.keyPresent).toBe("boolean");

    // A row stored with Google's raw body (before its words were read out).
    await row(
      google,
      "failed",
      0,
      '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
    );
    const [, raw] = await providerHealth({ id: makerId });
    expect(raw.lastError?.message).toBe(
      "Google rejected the API key — replace the key or use OpenAI.",
    );
    expect(raw.keyRejected).toBe(true);

    // The key replaced and checked from Settings: the error clears, and the
    // check costs nothing.
    const before = (await budget(makerId)).spentMicros;
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({ makerId, provider: "google", error: null });
    const [, checked] = await providerHealth({ id: makerId });
    expect(checked.lastError).toBeNull();
    expect(checked.keyRejected).toBe(false);
    expect((await budget(makerId)).spentMicros).toBe(before);
    // A check the provider refuses shows as its error.
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({
      makerId,
      provider: "google",
      error:
        "Google rejected the API key (400) — replace the key or use OpenAI.",
    });
    const [, refused] = await providerHealth({ id: makerId });
    expect(refused.lastError?.message).toBe(
      "Google rejected the API key (400) — replace the key or use OpenAI.",
    );
    expect(refused.keyRejected).toBe(true);
  });

  it("a move down a route counts as a failure of the provider it left", async () => {
    const at = new Date().toISOString();
    await db.generationJob.create({
      data: {
        makerId,
        cardId: "q.moved",
        mode: "live",
        status: "done",
        attempt: 1,
        maxAttempts: 3,
        estimateMicros: 1,
        request: {
          kind: "image",
          model: { provider: "google", model: "gemini-3.1-flash-image" },
        },
        route: {
          next: [],
          switched: [
            {
              from: { provider: "openai", model: "gpt-image-2" },
              to: { provider: "google", model: "gemini-3.1-flash-image" },
              reason: "OpenAI answered 503",
              at,
            },
          ],
        },
        finishedAt: new Date(),
      },
    });
    const [o, g] = await providerHealth({ id: makerId });
    expect(o.lastError?.message).toBe("OpenAI answered 503");
    expect(g.lastError).toBeNull();
  });
  it("keeps what a key check found its provider no longer lists; the latest check wins", async () => {
    expect(await readUnlisted(makerId)).toEqual({});
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({
      makerId,
      provider: "google",
      error: null,
      // A model Kiln has retired since is left out: it is refused anyway.
      unlisted: [
        "gemini-3.1-flash-lite-image",
        "veo-3.1-fast-generate-preview",
      ],
    });
    const found = await readUnlisted(makerId);
    expect(found.google?.models).toEqual(["gemini-3.1-flash-lite-image"]);
    expect(found.openai).toBeUndefined();
    const [, g] = await providerHealth({ id: makerId });
    expect(g.unlisted?.models).toEqual(["gemini-3.1-flash-lite-image"]);
    // A refused check lists nothing, so it leaves the last list in place.
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({ makerId, provider: "google", error: "rejected" });
    expect((await readUnlisted(makerId)).google?.models).toEqual([
      "gemini-3.1-flash-lite-image",
    ]);
    // A later check that lists every offered model clears it.
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({
      makerId,
      provider: "google",
      error: null,
      unlisted: [],
    });
    expect(await readUnlisted(makerId)).toEqual({});
  });
});

// Kiln's own refusals of a queued job are not the provider's: a job whose
// starter left, or who had no key they could use, never reached it.
describe.skipIf(!enabled)(
  "provider health skips Kiln's own refusals (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { providerHealth } = await import("@/server/provider-health");
    const makers: string[] = [];

    afterAll(async () => {
      await db.generationJob.deleteMany({ where: { makerId: { in: makers } } });
      await db.maker.deleteMany({ where: { id: { in: makers } } });
    });

    const studioWith = async (errors: string[]) => {
      const maker = await db.maker.create({
        data: {
          slug: `health-refusals-${Date.now()}-${makers.length}`,
          name: "Health",
        },
      });
      makers.push(maker.id);
      const request = {
        kind: "image",
        model: { provider: "openai", model: "gpt-image-2" },
      };
      await db.generationJob.create({
        data: {
          makerId: maker.id,
          cardId: "q.ok",
          mode: "live",
          status: "done",
          maxAttempts: 2,
          estimateMicros: 1,
          request,
          finishedAt: new Date(Date.now() - 30 * 60_000),
        },
      });
      for (const [i, error] of errors.entries()) {
        await db.generationJob.create({
          data: {
            makerId: maker.id,
            cardId: `q.refused-${i}`,
            mode: "live",
            status: "failed",
            maxAttempts: 2,
            estimateMicros: 1,
            request,
            error,
            finishedAt: new Date(Date.now() - (5 - i) * 60_000),
          },
        });
      }
      return maker.id;
    };

    it("a job whose starter left the team is not the provider's error", async () => {
      const makerId = await studioWith([
        "Not run: the person who queued it is no longer on the team, so nothing was spent.",
      ]);
      const [openai] = await providerHealth({ id: makerId });
      expect(openai.lastError).toBeNull();
      expect(openai.keyRejected).toBe(false);
    });

    it("a job refused for want of a key it could use is not the provider's error", async () => {
      const makerId = await studioWith([
        "Not run: the person who queued it has no OpenAI key they can use now, so nothing was spent.",
        "Not run: the studio has no OpenAI key for the whole team it can use now, so nothing was spent.",
      ]);
      const [openai] = await providerHealth({ id: makerId });
      expect(openai.lastError).toBeNull();
    });
  },
);

// A provider's health is the health of the key the reader's calls run on:
// a key rejected on Bob's calls is Bob's problem, not the team's. Rows from
// before keys were recorded count for the team key; a move made because no
// key was in reach counts for none. Studio S has a team key and Bob's key;
// studio T is another studio.
describe.skipIf(!enabled)(
  "provider health by the reader's key (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { providerHealth, checkKeyById } = await import(
      "@/server/provider-health"
    );
    const { withMakerKeys } = await import("@/server/provider-keys");
    const { providerBlock } = await import("@/lib/provider-block");
    const { recordKeyCheck } = await import("@/server/generation-repository");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;
    type Ref = Parameters<typeof withMakerKeys>[0];

    let s: Studio;
    let t: Studio;
    const ids: Record<string, string> = {};
    const REJECTED =
      "OpenAI rejected the API key — replace the key or use Google.";
    const openai = {
      kind: "image",
      model: { provider: "openai", model: "gpt-image-2" },
    };

    const job = (
      studio: Studio,
      minutesAgo: number,
      outcome: { status: "done" | "failed"; error?: string },
      providerKeyId?: string | null,
      route?: object,
    ) =>
      db.generationJob.create({
        data: {
          makerId: studio.makerId,
          cardId: "direct",
          mode: "live",
          status: outcome.status,
          maxAttempts: 1,
          estimateMicros: 1,
          request: openai,
          error: outcome.error,
          finishedAt: new Date(Date.now() - minutesAgo * 60_000),
          ...(providerKeyId === undefined ? {} : { providerKeyId }),
          ...(route ? { route } : {}),
        },
      });

    // What a page reads: the reader's health, inside the reader's keys.
    const healthOf = (maker: Ref) =>
      withMakerKeys(maker, async () => {
        const [o] = await providerHealth(maker);
        return o;
      });

    beforeAll(async () => {
      s = await fx.openStudio("health-s");
      t = await fx.openStudio("health-t");
      ids.team = await fx.writeKey(s, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-health-team-key-0001",
      });
      ids.bob = await fx.writeKey(s, {
        provider: "openai",
        name: "Bob's key",
        secret: REJECTED_SECRET,
        people: [s.bob],
      });
      await fx.writeKey(t, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-health-other-0002",
      });
      // Before keys were recorded: the team's.
      await job(s, 60, { status: "done" });
      // On the team key, and on Bob's.
      await job(s, 30, { status: "done" }, ids.team);
      await job(s, 5, { status: "failed", error: REJECTED }, ids.bob);
      // Another studio's rejected key, even one naming S's team key's id.
      await job(t, 1, { status: "failed", error: REJECTED }, ids.team);
      await job(t, 1, { status: "failed", error: REJECTED });
    });

    afterAll(async () => {
      await fx.closeStudio(s);
      await fx.closeStudio(t);
    });

    it("a key rejected on Bob's calls marks Bob's reading rejected and not Carla's team key", async () => {
      const bob = await healthOf(s.as(s.bob));
      expect(bob.keyRejected).toBe(true);
      expect(bob.lastError?.message).toMatch(/rejected the API key/);
      const carla = await healthOf(s.as(s.carla));
      expect(carla.keyRejected).toBe(false);
      expect(carla.lastError).toBeNull();
      expect(carla.lastOkAt).not.toBeNull();
      // The owner and a token run on the team key too.
      for (const reader of [s.as(s.ana), s.as()]) {
        expect((await healthOf(reader)).keyRejected).toBe(false);
      }
    });

    it("the board blocks Bob's click and not Carla's", async () => {
      const notes = async (maker: Ref) =>
        withMakerKeys(maker, () => providerHealth(maker));
      expect(
        providerBlock(await notes(s.as(s.carla)), "openai", "live", "Ana"),
      ).toBeNull();
      expect(
        providerBlock(await notes(s.as(s.bob)), "openai", "live", "Ana"),
      ).not.toBeNull();
    });

    it("a call from before keys were recorded counts for the team key", async () => {
      await job(s, 2, {
        status: "failed",
        error:
          "OpenAI is rate-limiting requests — try again in a minute or use Google.",
      });
      const carla = await healthOf(s.as(s.carla));
      expect(carla.lastError?.message).toMatch(/rate-limiting/);
      // Bob's key is another key: his reading is still its own.
      const bob = await healthOf(s.as(s.bob));
      expect(bob.keyRejected).toBe(true);
      // The team's call that works clears it.
      await job(s, 1, { status: "done" }, ids.team);
      expect((await healthOf(s.as(s.carla))).lastError).toBeNull();
    });

    it("a move made because no key was in reach counts for no key; one off a key counts for that key", async () => {
      // A job still queued on its next model: only its move is read.
      const moved = (keyId: string | null, reason: string) =>
        db.generationJob.create({
          data: {
            makerId: s.makerId,
            cardId: "q.moved",
            mode: "live",
            status: "queued",
            maxAttempts: 2,
            estimateMicros: 1,
            request: {
              kind: "image",
              model: { provider: "google", model: "gemini-3.1-flash-image" },
            },
            route: {
              next: [],
              switched: [
                {
                  from: { provider: "openai", model: "gpt-image-2" },
                  to: { provider: "google", model: "gemini-3.1-flash-image" },
                  reason,
                  at: new Date().toISOString(),
                  keyId,
                },
              ],
            },
          },
        });
      await new Promise((r) => setTimeout(r, 5));
      await moved(null, "OpenAI has no API key");
      expect((await healthOf(s.as(s.carla))).lastError).toBeNull();
      await new Promise((r) => setTimeout(r, 5));
      await moved(ids.team, "OpenAI answered 503");
      expect((await healthOf(s.as(s.carla))).lastError?.message).toBe(
        "OpenAI answered 503",
      );
      // Bob's key had no such move.
      expect((await healthOf(s.as(s.bob))).lastError?.message).toMatch(
        /rejected the API key/,
      );
    });

    it("models a provider no longer lists read the same for every reader", async () => {
      await recordKeyCheck({
        makerId: s.makerId,
        provider: "google",
        error: null,
        unlisted: ["gemini-3.1-flash-lite-image"],
      });
      const google = async (maker: Ref) =>
        withMakerKeys(maker, async () => (await providerHealth(maker))[1]);
      const [bob, carla] = [
        await google(s.as(s.bob)),
        await google(s.as(s.carla)),
      ];
      expect(bob.unlisted?.models).toEqual(["gemini-3.1-flash-lite-image"]);
      expect(carla.unlisted).toEqual(bob.unlisted);
    });

    it("checking Bob's key, which the provider rejects, is kept on Bob's key and leaves the team key clean", async () => {
      // Bob's key is checked by the owner, and answers rejected.
      const before = await healthOf(s.as(s.carla));
      const checked = await checkKeyById(s.as(s.ana), ids.bob);
      expect(checked).toMatchObject({ ok: false });
      const recorded = await db.generationJob.findFirstOrThrow({
        where: {
          makerId: s.makerId,
          cardId: "key-check",
          providerKeyId: ids.bob,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(recorded.status).toBe("failed");
      expect(await healthOf(s.as(s.carla))).toMatchObject({
        keyRejected: false,
        lastError: before.lastError,
      });
      expect((await healthOf(s.as(s.bob))).keyRejected).toBe(true);
    });
  },
);

// A move made because no key was in reach is nobody's key failure: Bob's
// given OpenAI key cannot be read, so his job moves to Google with `keyId`
// null, and Carla, on the team's OpenAI key, reads no error from it.
describe.skipIf(!enabled)(
  "provider health and a move with no key in reach (database)",
  async () => {
    const { randomUUID } = await import("node:crypto");
    const { db } = await import("@/lib/db");
    const { providerHealth } = await import("@/server/provider-health");
    const { withMakerKeys } = await import("@/server/provider-keys");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;

    const MODE = `health-keyless-${randomUUID().slice(0, 8)}`;
    let s: Studio;

    beforeAll(async () => {
      s = await fx.openStudio("health-keyless");
      await fx.writeKey(s, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-health-keyless-team-01",
      });
      await fx.writeKey(s, {
        provider: "openai",
        name: "Bob's key",
        secret: "sk-fixture-health-keyless-bob-002",
        people: [s.bob],
        unreadable: true,
      });
      await fx.writeKey(s, {
        provider: "google",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-health-keyless-google-3",
      });
    });

    afterAll(async () => {
      await fx.closeStudio(s);
    });

    it("Bob's job moving off his unreadable key is not the team key's failure", async () => {
      const projectId = await fx.bareProject(s);
      const id = await fx.queueJob(s, {
        mode: MODE,
        projectId,
        cardId: "keyless.bob",
        memberId: s.bob.memberId,
        route: {
          next: [{ provider: "google", model: "gemini-3.1-flash-image" }],
          switched: [],
        },
      });
      const worker = await fx.keysWorker({ mode: MODE, seen: [] });
      worker.wake();
      await worker.idle();
      worker.stop();
      const job = await db.generationJob.findFirstOrThrow({
        where: { id, makerId: s.makerId },
      });
      const [move] = (job.route as { switched: Record<string, unknown>[] })
        .switched;
      expect(move).toMatchObject({ from: { provider: "openai" } });
      expect(move).toHaveProperty("keyId", null);
      // It ran in a mode of this file's own, so no other worker claimed it;
      // health reads live rows, as a live worker leaves them.
      await db.generationJob.updateMany({
        where: { id, makerId: s.makerId },
        data: { mode: "live" },
      });

      const carla = s.as(s.carla);
      const [openai] = await withMakerKeys(carla, () => providerHealth(carla));
      expect(openai.lastError).toBeNull();
      expect(openai.keyRejected).toBe(false);
      // Nor is it the owner's or a token's, on the same team key.
      for (const reader of [s.as(s.ana), s.as()]) {
        const [o] = await withMakerKeys(reader, () => providerHealth(reader));
        expect(o.lastError).toBeNull();
      }
    });
  },
);

// Each provider's health also says, for its reader, whether a key is in
// reach (and why not) and whether it was given to them: what the refusals
// and the member's line are built from. Studio S: a team OpenAI key and Bob's
// own; a Google key given to Bob only.
describe.skipIf(!enabled)(
  "provider health says the reader's reach (database)",
  async () => {
    const { providerHealth } = await import("@/server/provider-health");
    const { withMakerKeys } = await import("@/server/provider-keys");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;
    type Ref = Parameters<typeof withMakerKeys>[0];

    let s: Studio;

    beforeAll(async () => {
      s = await fx.openStudio("health-reach");
      await fx.writeKey(s, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-health-reach-team-01",
      });
      await fx.writeKey(s, {
        provider: "openai",
        name: "Bob's key",
        secret: "sk-fixture-health-reach-bob-002",
        people: [s.bob],
      });
      await fx.writeKey(s, {
        provider: "google",
        name: "Bob's key",
        secret: "AIza-fixture-health-reach-bob-03",
        people: [s.bob],
      });
    });

    afterAll(async () => {
      await fx.closeStudio(s);
    });

    const read = (maker: Ref) =>
      withMakerKeys(maker, async () =>
        Object.fromEntries(
          (await providerHealth(maker)).map((h) => [
            h.provider,
            { keyPresent: h.keyPresent, reach: h.reach, given: h.given },
          ]),
        ),
      );

    it("Bob runs on keys given to him for both providers", async () => {
      expect(await read(s.as(s.bob))).toEqual({
        openai: { keyPresent: true, reach: "in-reach", given: true },
        google: { keyPresent: true, reach: "in-reach", given: true },
      });
    });

    it("Carla runs on the team's OpenAI key, and Google's only key is someone else's", async () => {
      expect(await read(s.as(s.carla))).toEqual({
        openai: { keyPresent: true, reach: "in-reach", given: false },
        google: { keyPresent: false, reach: "not-yours", given: false },
      });
    });

    it("a token reads the team's reach, never a person's key", async () => {
      expect(await read(s.as())).toEqual({
        openai: { keyPresent: true, reach: "in-reach", given: false },
        google: { keyPresent: false, reach: "not-yours", given: false },
      });
    });
  },
);

// The owner's list of keys: every key of the studio, its people named only
// from the studio's own team, and the line on the owner's own calls. Never
// a secret, a sealed value or anything of another studio's, even when an
// access row of this studio names a person of the other one.
describe.skipIf(!enabled)("the owner's list of keys (database)", async () => {
  const { db } = await import("@/lib/db");
  const { providerKeyList } = await import("@/server/provider-health");
  const { withMakerKeys } = await import("@/server/provider-keys");
  const fx = await import("@/server/__tests__/fixtures/studio-keys");
  type Studio = Awaited<ReturnType<typeof fx.openStudio>>;
  type Ref = Parameters<typeof withMakerKeys>[0];

  let p: Studio;
  let q: Studio;
  let own: Studio;
  let others: Studio;
  const ids: Record<string, string> = {};
  const SECRETS = {
    pTeam: "sk-fixture-list-p-team-0000p1a1",
    pBob: "sk-fixture-list-p-bob-00000p2b2",
    pNobody: "sk-fixture-list-p-nobody-00p3c3",
    pGoogle: "AIza-fixture-list-p-google-0p4d4",
    qTeam: "sk-fixture-list-q-team-0000q5e5",
    qBob: "sk-fixture-list-q-bob-00000q6f6",
    ownTeam: "sk-fixture-list-own-team-00o7g7",
    ownAna: "sk-fixture-list-own-ana-000o8h8",
    othersCarla: "sk-fixture-list-others-carl9i9",
  };

  const list = (maker: Ref) =>
    withMakerKeys(maker, () => providerKeyList(maker));

  beforeAll(async () => {
    p = await fx.openStudio("list-p");
    q = await fx.openStudio("list-q");
    ids.pTeam = await fx.writeKey(p, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: SECRETS.pTeam,
    });
    ids.pBob = await fx.writeKey(p, {
      provider: "openai",
      name: "Bob's key",
      secret: SECRETS.pBob,
      people: [p.bob],
    });
    // Given to studio Q's Carla, who is not on P's team: the database lets
    // the row be; the list must not name her.
    ids.pNobody = await fx.writeKey(p, {
      provider: "openai",
      name: "Left key",
      secret: SECRETS.pNobody,
      people: [q.carla],
    });
    ids.pGoogle = await fx.writeKey(p, {
      provider: "google",
      name: "Team key",
      forTeam: true,
      secret: SECRETS.pGoogle,
      unreadable: true,
    });
    ids.qTeam = await fx.writeKey(q, {
      provider: "openai",
      name: "Q team key",
      forTeam: true,
      secret: SECRETS.qTeam,
    });
    ids.qBob = await fx.writeKey(q, {
      provider: "openai",
      name: "Q Bob key",
      secret: SECRETS.qBob,
      people: [q.bob],
    });
    // The owner with a key of her own beside the team's.
    own = await fx.openStudio("list-own");
    await fx.writeKey(own, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: SECRETS.ownTeam,
    });
    await fx.writeKey(own, {
      provider: "openai",
      name: "Ana's key",
      secret: SECRETS.ownAna,
      people: [own.ana],
    });
    // Every key is for someone else.
    others = await fx.openStudio("list-others");
    await fx.writeKey(others, {
      provider: "openai",
      name: "Carla's key",
      secret: SECRETS.othersCarla,
      people: [others.carla],
    });
  });

  afterAll(async () => {
    for (const studio of [p, q, own, others]) await fx.closeStudio(studio);
  });

  it("lists every key of the studio with its last four and its people", async () => {
    const text = JSON.stringify(await list(p.as(p.ana)));
    for (const id of [ids.pTeam, ids.pBob, ids.pNobody, ids.pGoogle]) {
      expect(text).toContain(id);
    }
    for (const name of ["Team key", "Bob's key", "Left key"]) {
      expect(text).toContain(name);
    }
    for (const secret of [SECRETS.pTeam, SECRETS.pBob, SECRETS.pNobody]) {
      expect(text).toContain(secret.slice(-4));
    }
    expect(text).toContain("Bob Ruiz");
    expect(text).toContain(p.bob.email);
  });

  it("holds no key, no person and nothing else of another studio's", async () => {
    const text = JSON.stringify(await list(p.as(p.ana)));
    for (const leak of [
      ids.qTeam,
      ids.qBob,
      "Q team key",
      "Q Bob key",
      SECRETS.qTeam.slice(-4),
      SECRETS.qBob.slice(-4),
      q.makerId,
      q.ana.email,
      q.bob.email,
      q.carla.email,
      q.ana.memberId,
      q.bob.memberId,
      q.carla.memberId,
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it("holds no secret and no sealed value", async () => {
    const text = JSON.stringify(await list(p.as(p.ana)));
    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
    const sealed = await db.providerKey.findMany({
      where: { makerId: p.makerId },
      select: { sealed: true },
    });
    for (const row of sealed) expect(text).not.toContain(row.sealed);
    expect(text).not.toContain("v1.");
  });

  it("says which key the owner's own calls run on", async () => {
    expect(JSON.stringify(await list(p.as(p.ana)))).toContain(
      "Your calls run on Team key.",
    );
    expect(JSON.stringify(await list(own.as(own.ana)))).toContain(
      "Your calls run on Ana's key.",
    );
  });

  it("says when the key the owner's calls run on cannot be read", async () => {
    // P's only Google key is the team's, and it cannot be read.
    expect(JSON.stringify(await list(p.as(p.ana)))).toContain(
      "Your calls run on Team key, which cannot be read now.",
    );
  });

  it("gives someone who is not the owner nothing", async () => {
    expect(await list(p.as(p.bob))).toEqual([]);
    expect(await list(own.as(own.bob))).toEqual([]);
  });

  it("says when every key is for others", async () => {
    expect(JSON.stringify(await list(others.as(others.ana)))).toContain(
      "No OpenAI key is yours or the team's, so your calls cannot use OpenAI.",
    );
  });
});

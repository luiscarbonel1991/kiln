import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SeenCall } from "@/server/__tests__/fixtures/studio-keys";

// The owner's key actions against the throwaway Postgres (see
// project-repository.db.test.ts), with the worker of worker-keys.db.test.ts:
// what happens to queued and running work when a key is taken away, and
// that another studio's ids are never trusted. The session is the owner of
// the studio a test names; the free check is a fake that accepts every key,
// so no request goes out.
const session = vi.hoisted(() => ({
  current: null as null | {
    id: string;
    slug: string;
    name: string;
    member: { id: string; userId: string; role: "owner" | "member" };
  },
}));
vi.mock("@/server/session", () => ({
  requireMaker: async () => {
    if (!session.current) throw new Error("no session in this test");
    return session.current;
  },
  denyWithoutSession: async () => null,
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/providers/mode", async (original) => ({
  ...(await original<typeof import("@/providers/mode")>()),
  providerMode: () => "live",
}));
vi.mock("@/providers/key-check", () => ({
  checkProviderKey: async () => ({ ok: true, called: true, models: [] }),
}));

const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("the owner's key actions (database)", async () => {
  const { db } = await import("@/lib/db");
  const fx = await import("@/server/__tests__/fixtures/studio-keys");
  const actions = await import("@/app/actions/settings");
  type Studio = Awaited<ReturnType<typeof fx.openStudio>>;

  const MODE = `key-actions-${randomUUID().slice(0, 8)}`;
  const studios: Studio[] = [];
  let n = 0;
  const secret = () => `sk-fixture-actions-${String(++n).padStart(12, "0")}`;

  const open = async (label: string) => {
    const studio = await fx.openStudio(label);
    studios.push(studio);
    return studio;
  };
  // Signed in as the studio's owner.
  const asOwner = (studio: Studio) => {
    session.current = {
      id: studio.makerId,
      slug: studio.label,
      name: studio.label,
      member: {
        id: studio.ana.memberId,
        userId: studio.ana.userId,
        role: "owner",
      },
    };
  };
  const withTeamAndBob = async (label: string) => {
    const studio = await open(label);
    const team = secret();
    const bob = secret();
    const ids = {
      team: await fx.writeKey(studio, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: team,
      }),
      bob: await fx.writeKey(studio, {
        provider: "openai",
        name: "Bob's key",
        secret: bob,
        people: [studio.bob],
      }),
    };
    return { studio, ids, secrets: { team, bob } };
  };
  const rowsOf = async (studio: Studio) => ({
    keys: await db.providerKey.findMany({
      where: { makerId: studio.makerId },
      orderBy: { id: "asc" },
    }),
    access: await db.providerKeyAccess.findMany({
      where: { makerId: studio.makerId },
      orderBy: [{ keyId: "asc" }, { memberId: "asc" }],
    }),
  });
  const keyOf = (seen: SeenCall[], card: string) =>
    seen.filter((s) => s.card === card).map((s) => s.key);

  beforeAll(() => {
    session.current = null;
  });

  afterAll(async () => {
    session.current = null;
    for (const studio of studios) await fx.closeStudio(studio);
  });

  it("adding a key saves it, checks it for free, and refuses a name or a team key already taken", async () => {
    const { studio } = await withTeamAndBob("actions-add");
    asOwner(studio);
    expect(
      await actions.addProviderKeyAction({
        provider: "openai",
        name: "Carla's key",
        who: "people",
        memberIds: [studio.carla.memberId],
        key: secret(),
      }),
    ).toMatchObject({ ok: true, message: "Saved. OpenAI accepts the key." });
    const before = await rowsOf(studio);
    expect(
      await actions.addProviderKeyAction({
        provider: "openai",
        name: "Carla's key",
        who: "people",
        memberIds: [studio.carla.memberId],
        key: secret(),
      }),
    ).toMatchObject({
      ok: false,
      field: "name",
      message: "Another OpenAI key has that name.",
    });
    expect(
      await actions.addProviderKeyAction({
        provider: "openai",
        name: "Second team key",
        who: "team",
        memberIds: [],
        key: secret(),
      }),
    ).toMatchObject({
      ok: false,
      message: "The team has an OpenAI key already: replace that one.",
    });
    expect(await rowsOf(studio)).toEqual(before);
  });

  it("another studio's key id or person, handed to this studio's owner, is refused and nothing is written in either studio", async () => {
    const mine = await withTeamAndBob("actions-mine");
    const theirs = await withTeamAndBob("actions-theirs");
    asOwner(mine.studio);
    const before = [await rowsOf(mine.studio), await rowsOf(theirs.studio)];
    const answers = [
      await actions.removeProviderKeyByIdAction({ keyId: theirs.ids.bob }),
      await actions.replaceProviderKeyAction({
        keyId: theirs.ids.team,
        key: secret(),
      }),
      await actions.editProviderKeyAction({
        keyId: theirs.ids.bob,
        name: "Mine now",
        who: "people",
        memberIds: [mine.studio.carla.memberId],
      }),
      await actions.checkProviderKeyByIdAction({ keyId: theirs.ids.team }),
      await actions.addProviderKeyAction({
        provider: "google",
        name: "For their Bob",
        who: "people",
        memberIds: [theirs.studio.bob.memberId],
        key: secret(),
      }),
      await actions.editProviderKeyAction({
        keyId: mine.ids.bob,
        name: "Bob's key",
        who: "people",
        memberIds: [theirs.studio.carla.memberId],
      }),
    ];
    for (const answer of answers) expect(answer).toMatchObject({ ok: false });
    expect([await rowsOf(mine.studio), await rowsOf(theirs.studio)]).toEqual(
      before,
    );
    // Nor was a check recorded on either studio.
    expect(
      await db.generationJob.count({
        where: {
          makerId: { in: [mine.studio.makerId, theirs.studio.makerId] },
          cardId: "key-check",
        },
      }),
    ).toBe(0);
  });

  it("a key removed while a job of Bob's waits in the queue: the job picks again when it runs, on the team's key", async () => {
    const { studio, ids, secrets } = await withTeamAndBob("actions-queued");
    const projectId = await fx.bareProject(studio);
    const job = await fx.queueJob(studio, {
      mode: MODE,
      projectId,
      cardId: "queued.bob",
      memberId: studio.bob.memberId,
    });
    asOwner(studio);
    expect(
      await actions.removeProviderKeyByIdAction({ keyId: ids.bob }),
    ).toMatchObject({ ok: true });
    const seen: SeenCall[] = [];
    const worker = await fx.keysWorker({ mode: MODE, seen });
    worker.wake();
    await worker.idle();
    worker.stop();
    expect(keyOf(seen, "queued.bob")).toEqual([secrets.team]);
    expect(
      await db.generationJob.findUniqueOrThrow({ where: { id: job } }),
    ).toMatchObject({ status: "done", providerKeyId: ids.team });
  });

  it("a key removed while Bob's job is running: the call in flight finishes on the key it took, and his next job does not get it", async () => {
    const { studio, ids, secrets } = await withTeamAndBob("actions-running");
    const projectId = await fx.bareProject(studio);
    const first = await fx.queueJob(studio, {
      mode: MODE,
      projectId,
      cardId: "running.bob-1",
      memberId: studio.bob.memberId,
    });
    const next = await fx.queueJob(studio, {
      mode: MODE,
      projectId,
      cardId: "running.bob-2",
      memberId: studio.bob.memberId,
    });
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: SeenCall[] = [];
    const worker = await fx.keysWorker({ mode: MODE, seen, hold });
    worker.wake();
    // The first call is out, on Bob's key.
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 5_000 });
    asOwner(studio);
    expect(
      await actions.removeProviderKeyByIdAction({ keyId: ids.bob }),
    ).toMatchObject({ ok: true });
    release();
    await worker.idle();
    worker.stop();
    expect(keyOf(seen, "running.bob-1")).toEqual([secrets.bob]);
    expect(keyOf(seen, "running.bob-2")).toEqual([secrets.team]);
    expect(
      await db.generationJob.findUniqueOrThrow({ where: { id: first } }),
    ).toMatchObject({ status: "done", providerKeyId: ids.bob });
    expect(
      await db.generationJob.findUniqueOrThrow({ where: { id: next } }),
    ).toMatchObject({ status: "done", providerKeyId: ids.team });
  });

  it("removing a key removed already says so, and changes nothing", async () => {
    const { studio, ids } = await withTeamAndBob("actions-twice");
    asOwner(studio);
    expect(
      await actions.removeProviderKeyByIdAction({ keyId: ids.bob }),
    ).toMatchObject({ ok: true });
    const before = await rowsOf(studio);
    expect(
      await actions.removeProviderKeyByIdAction({ keyId: ids.bob }),
    ).toMatchObject({ ok: false, message: "That key was removed already." });
    expect(await rowsOf(studio)).toEqual(before);
  });

  it("a key whose last person left is kept: it can be given to someone again, or removed", async () => {
    const studio = await open("actions-nobody");
    const id = await fx.writeKey(studio, {
      provider: "google",
      name: "Carla's key",
      secret: secret(),
      people: [studio.carla],
    });
    await db.member.delete({ where: { id: studio.carla.memberId } });
    expect(await db.providerKey.findUnique({ where: { id } })).not.toBeNull();
    asOwner(studio);
    expect(
      await actions.editProviderKeyAction({
        keyId: id,
        name: "Carla's key",
        who: "people",
        memberIds: [studio.bob.memberId],
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await db.providerKeyAccess.findMany({
          where: { keyId: id },
          select: { memberId: true },
        })
      ).map((r) => r.memberId),
    ).toEqual([studio.bob.memberId]);
    expect(
      await actions.removeProviderKeyByIdAction({ keyId: id }),
    ).toMatchObject({ ok: true });
    expect(await db.providerKey.findUnique({ where: { id } })).toBeNull();
  });

  it("checking one key records the answer on that key", async () => {
    const { studio, ids } = await withTeamAndBob("actions-check");
    asOwner(studio);
    expect(
      await actions.checkProviderKeyByIdAction({ keyId: ids.bob }),
    ).toMatchObject({ ok: true });
    const checks = await db.generationJob.findMany({
      where: { makerId: studio.makerId, cardId: "key-check" },
      select: { providerKeyId: true, memberId: true, status: true },
    });
    expect(checks).toEqual([
      { providerKeyId: ids.bob, memberId: studio.ana.memberId, status: "done" },
    ]);
  });
});

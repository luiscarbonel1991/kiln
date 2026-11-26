import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The rules about keys that the database itself keeps, whatever code writes
// the rows (against the throwaway Postgres: see project-repository.db.test.ts).
// Two studios, each with Ana (owner), Bob and Carla; every assertion reads
// the rows this file made.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("the database keeps the key rules", async () => {
  const { db } = await import("@/lib/db");
  const { closeStudio, openStudio, writeKey } = await import(
    "@/server/__tests__/fixtures/studio-keys"
  );
  type Studio = Awaited<ReturnType<typeof openStudio>>;

  let a: Studio;
  let b: Studio;

  beforeAll(async () => {
    a = await openStudio("rules-a");
    b = await openStudio("rules-b");
  });

  afterAll(async () => {
    await closeStudio(a);
    await closeStudio(b);
  });

  // Refused by the database: a unique index (P2002) or a foreign key (P2003).
  const refused = (work: Promise<unknown>, code: "P2002" | "P2003") =>
    expect(work).rejects.toMatchObject({ code });

  const secret = (tail: string) => `sk-fixture-rules-0000000000${tail}`;

  it("a studio holds one team key per provider; each provider, and each studio, its own", async () => {
    await writeKey(a, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: secret("a001"),
    });
    await refused(
      writeKey(a, {
        provider: "openai",
        name: "Second team key",
        forTeam: true,
        secret: secret("a002"),
      }),
      "P2002",
    );
    await writeKey(a, {
      provider: "google",
      name: "Team key",
      forTeam: true,
      secret: secret("a003"),
    });
    await writeKey(b, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: secret("b001"),
    });
    const teams = await db.providerKey.findMany({
      where: { makerId: { in: [a.makerId, b.makerId] }, forTeam: true },
      select: { makerId: true, provider: true },
    });
    expect(
      teams.map((t) => `${t.makerId === a.makerId ? "a" : "b"}:${t.provider}`),
    ).toEqual(expect.arrayContaining(["a:openai", "a:google", "b:openai"]));
    expect(teams).toHaveLength(3);
  });

  it("two keys of one provider may not share a name in a studio", async () => {
    await refused(
      writeKey(a, {
        provider: "openai",
        name: "Team key",
        secret: secret("a004"),
      }),
      "P2002",
    );
  });

  it("a person holds one given key per provider, and one of each provider", async () => {
    const first = await writeKey(a, {
      provider: "openai",
      name: "Bob's key",
      secret: secret("a005"),
      people: [a.bob],
    });
    const second = await writeKey(a, {
      provider: "openai",
      name: "Bob's other key",
      secret: secret("a006"),
    });
    await refused(
      db.providerKeyAccess.create({
        data: {
          makerId: a.makerId,
          keyId: second,
          provider: "openai",
          memberId: a.bob.memberId,
        },
      }),
      "P2002",
    );
    await writeKey(a, {
      provider: "google",
      name: "Bob's key",
      secret: secret("a007"),
      people: [a.bob],
    });
    const bobs = await db.providerKeyAccess.findMany({
      where: { makerId: a.makerId, memberId: a.bob.memberId },
      select: { keyId: true, provider: true },
    });
    expect(bobs.map((r) => r.provider).sort()).toEqual(["google", "openai"]);
    expect(bobs.find((r) => r.provider === "openai")?.keyId).toBe(first);
  });

  it("an access row cannot name a key of another studio or another provider", async () => {
    const carlas = await writeKey(a, {
      provider: "openai",
      name: "Carla's key",
      secret: secret("a008"),
    });
    // Studio B's maker on studio A's key.
    await refused(
      db.providerKeyAccess.create({
        data: {
          makerId: b.makerId,
          keyId: carlas,
          provider: "openai",
          memberId: b.carla.memberId,
        },
      }),
      "P2003",
    );
    // A Google access row on an OpenAI key.
    await refused(
      db.providerKeyAccess.create({
        data: {
          makerId: a.makerId,
          keyId: carlas,
          provider: "google",
          memberId: a.carla.memberId,
        },
      }),
      "P2003",
    );
    expect(
      await db.providerKeyAccess.findMany({ where: { keyId: carlas } }),
    ).toEqual([]);
  });

  it("a person deleted from the team (as Better Auth's remove and leave do) loses their access rows, and only theirs", async () => {
    const shared = await writeKey(b, {
      provider: "google",
      name: "Shared key",
      secret: secret("b002"),
      people: [b.bob, b.carla],
    });
    await writeKey(b, {
      provider: "openai",
      name: "Bob's key",
      secret: secret("b003"),
      people: [b.bob],
    });
    // A direct delete of the Member row: no Kiln code, no hook.
    await db.member.delete({ where: { id: b.bob.memberId } });
    const left = await db.providerKeyAccess.findMany({
      where: { makerId: b.makerId },
      select: { keyId: true, memberId: true },
    });
    expect(left).toEqual([{ keyId: shared, memberId: b.carla.memberId }]);
    // The keys themselves stay.
    expect(
      await db.providerKey.count({
        where: {
          makerId: b.makerId,
          name: { in: ["Shared key", "Bob's key"] },
        },
      }),
    ).toBe(2);
  });

  it("removing a key removes who it was given to", async () => {
    const key = await writeKey(a, {
      provider: "google",
      name: "Carla's key",
      secret: secret("a009"),
      people: [a.carla],
    });
    await db.providerKey.delete({ where: { id: key } });
    expect(
      await db.providerKeyAccess.findMany({ where: { keyId: key } }),
    ).toEqual([]);
  });

  it("a call's record keeps the key it ran on after the key is removed", async () => {
    const key = await writeKey(a, {
      provider: "openai",
      name: "Short-lived key",
      secret: secret("a010"),
    });
    const job = await db.generationJob.create({
      data: {
        makerId: a.makerId,
        cardId: "direct",
        mode: "live",
        status: "done",
        maxAttempts: 1,
        estimateMicros: 1,
        actualMicros: 1,
        finishedAt: new Date(),
        providerKeyId: key,
      },
      select: { id: true },
    });
    await db.providerKey.delete({ where: { id: key } });
    expect(
      await db.generationJob.findUniqueOrThrow({
        where: { id: job.id },
        select: { providerKeyId: true },
      }),
    ).toEqual({ providerKeyId: key });
  });
});

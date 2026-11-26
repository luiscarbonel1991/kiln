import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The owner's writes of a studio's keys: each takes a key id and people's
// ids from the client and trusts neither, reading the key under its own
// studio and the people through its own team before it writes (against the
// throwaway Postgres: see project-repository.db.test.ts). Two studios, each
// with Ana (owner), Bob and Carla; fixture keys only, nothing is checked
// with a provider here.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("writing a studio's keys (database)", async () => {
  const { db } = await import("@/lib/db");
  const { providerKey } = await import("@/providers/keys");
  const keys = await import("@/server/provider-keys");
  const fx = await import("@/server/__tests__/fixtures/studio-keys");
  type Studio = Awaited<ReturnType<typeof fx.openStudio>>;

  const studios: Studio[] = [];
  let a: Studio;
  let b: Studio;
  const ids: Record<string, string> = {};
  let n = 0;
  const secret = () => `sk-fixture-writes-${String(++n).padStart(12, "0")}`;

  const open = async (label: string) => {
    const studio = await fx.openStudio(label);
    studios.push(studio);
    return studio;
  };
  const owner = (studio: Studio) => studio.as(studio.ana);

  // Every key row and access row of a studio, to compare before and after.
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
  const accessOf = async (keyId: string) =>
    (
      await db.providerKeyAccess.findMany({
        where: { keyId },
        select: { memberId: true },
      })
    )
      .map((r) => r.memberId)
      .sort();
  const keyNamed = (studio: Studio, name: string) =>
    db.providerKey.findFirst({ where: { makerId: studio.makerId, name } });

  beforeAll(async () => {
    a = await open("writes-a");
    b = await open("writes-b");
    ids.aTeam = await fx.writeKey(a, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: secret(),
    });
    ids.bTeam = await fx.writeKey(b, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: secret(),
    });
    ids.bBob = await fx.writeKey(b, {
      provider: "openai",
      name: "Bob's key",
      secret: secret(),
      people: [b.bob],
    });
  });

  afterAll(async () => {
    for (const studio of studios) await fx.closeStudio(studio);
  });

  it("adds a key for chosen people, sealed, named, and runs their work on it", async () => {
    const raw = secret();
    await keys.addProviderKey(owner(a), {
      provider: "openai",
      name: "Bob's key",
      who: "people",
      memberIds: [a.bob.memberId],
      key: raw,
    });
    const row = await keyNamed(a, "Bob's key");
    expect(row).toMatchObject({
      provider: "openai",
      forTeam: false,
      hint: raw.slice(-4),
    });
    expect(row?.sealed).not.toContain(raw);
    ids.aBob = row?.id ?? "";
    expect(await accessOf(ids.aBob)).toEqual([a.bob.memberId]);
    expect(
      await keys.withMakerKeys(a.as(a.bob), async () => providerKey("openai")),
    ).toBe(raw);
  });

  it("another studio's key id, or another studio's person, is refused, and nothing changes in either studio", async () => {
    const before = [await rowsOf(a), await rowsOf(b)];
    const attempts = [
      () =>
        keys.editProviderKey(owner(a), {
          keyId: ids.bBob,
          name: "Taken",
          who: "people",
          memberIds: [a.carla.memberId],
        }),
      () =>
        keys.replaceProviderKey(owner(a), { keyId: ids.bBob, key: secret() }),
      () => keys.removeProviderKey(owner(a), ids.bTeam),
      () =>
        keys.addProviderKey(owner(a), {
          provider: "google",
          name: "For someone else",
          who: "people",
          memberIds: [b.bob.memberId],
          key: secret(),
        }),
      () =>
        keys.editProviderKey(owner(a), {
          keyId: ids.aBob,
          name: "Bob's key",
          who: "people",
          memberIds: [a.bob.memberId, b.carla.memberId],
        }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow();
    expect([await rowsOf(a), await rowsOf(b)]).toEqual(before);
  });

  it("a second team key is refused in the owner's words", async () => {
    const before = await rowsOf(a);
    await expect(
      keys.addProviderKey(owner(a), {
        provider: "openai",
        name: "Another team key",
        who: "team",
        memberIds: [],
        key: secret(),
      }),
    ).rejects.toThrow("The team has an OpenAI key already: replace that one.");
    expect(await rowsOf(a)).toEqual(before);
  });

  it("giving a person a second key of a provider moves them to it, and the first key stays", async () => {
    await keys.addProviderKey(owner(a), {
      provider: "openai",
      name: "Bob's new key",
      who: "people",
      memberIds: [a.bob.memberId],
      key: secret(),
    });
    const moved = await keyNamed(a, "Bob's new key");
    expect(await accessOf(moved?.id ?? "")).toEqual([a.bob.memberId]);
    expect(await accessOf(ids.aBob)).toEqual([]);
    expect(await keyNamed(a, "Bob's key")).not.toBeNull();
  });

  it("changing a key to the whole team drops its people", async () => {
    await keys.addProviderKey(owner(a), {
      provider: "google",
      name: "Carla's key",
      who: "people",
      memberIds: [a.carla.memberId],
      key: secret(),
    });
    const carlas = await keyNamed(a, "Carla's key");
    await keys.editProviderKey(owner(a), {
      keyId: carlas?.id ?? "",
      name: "Team key",
      who: "team",
      memberIds: [],
    });
    expect(
      await db.providerKey.findUniqueOrThrow({ where: { id: carlas?.id } }),
    ).toMatchObject({ name: "Team key", forTeam: true });
    expect(await accessOf(carlas?.id ?? "")).toEqual([]);
  });

  it("replacing a key keeps its id, name and people, and the next work runs on the new secret", async () => {
    const studio = await open("writes-replace");
    const old = secret();
    const id = await fx.writeKey(studio, {
      provider: "openai",
      name: "Bob's key",
      secret: old,
      people: [studio.bob],
    });
    expect(
      await keys.withMakerKeys(studio.as(studio.bob), async () =>
        providerKey("openai"),
      ),
    ).toBe(old);
    const raw = secret();
    await keys.replaceProviderKey(owner(studio), { keyId: id, key: raw });
    const row = await db.providerKey.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ id, name: "Bob's key", hint: raw.slice(-4) });
    expect(await accessOf(id)).toEqual([studio.bob.memberId]);
    expect(
      await keys.withMakerKeys(studio.as(studio.bob), async () =>
        providerKey("openai"),
      ),
    ).toBe(raw);
  });

  it("a key that cannot be read can be replaced: that is the fix", async () => {
    const studio = await open("writes-unreadable");
    const id = await fx.writeKey(studio, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: secret(),
      unreadable: true,
    });
    expect(
      await keys.withMakerKeys(studio.as(), async () => providerKey("openai")),
    ).toBeUndefined();
    const raw = secret();
    await keys.replaceProviderKey(owner(studio), { keyId: id, key: raw });
    expect(
      await keys.withMakerKeys(studio.as(), async () => providerKey("openai")),
    ).toBe(raw);
  });

  it("a key removed already is refused in words, for each write", async () => {
    const studio = await open("writes-removed");
    const id = await fx.writeKey(studio, {
      provider: "openai",
      name: "Bob's key",
      secret: secret(),
      people: [studio.bob],
    });
    await keys.removeProviderKey(owner(studio), id);
    expect(await db.providerKey.findUnique({ where: { id } })).toBeNull();
    const gone = "That key was removed already.";
    await expect(keys.removeProviderKey(owner(studio), id)).rejects.toThrow(
      gone,
    );
    await expect(
      keys.replaceProviderKey(owner(studio), { keyId: id, key: secret() }),
    ).rejects.toThrow(gone);
    await expect(
      keys.editProviderKey(owner(studio), {
        keyId: id,
        name: "Bob's key",
        who: "people",
        memberIds: [studio.bob.memberId],
      }),
    ).rejects.toThrow(gone);
  });

  it("a person who left meanwhile cannot be given a key, and nothing is written", async () => {
    const studio = await open("writes-left");
    await db.member.delete({ where: { id: studio.carla.memberId } });
    const before = await rowsOf(studio);
    await expect(
      keys.addProviderKey(owner(studio), {
        provider: "openai",
        name: "Carla's key",
        who: "people",
        memberIds: [studio.carla.memberId],
        key: secret(),
      }),
    ).rejects.toThrow(/is no longer on the team\./);
    expect(await rowsOf(studio)).toEqual(before);
  });

  it("a key whose last person left is kept, given to no one", async () => {
    const studio = await open("writes-nobody");
    const id = await fx.writeKey(studio, {
      provider: "openai",
      name: "Carla's key",
      secret: secret(),
      people: [studio.carla],
    });
    await db.member.delete({ where: { id: studio.carla.memberId } });
    expect(await db.providerKey.findUnique({ where: { id } })).not.toBeNull();
    expect(await accessOf(id)).toEqual([]);
    const listed = await keys.listProviderKeys(owner(studio));
    expect(JSON.stringify(listed)).toContain(id);
  });

  it("the owner's list names each key's people from the studio's own team, and holds no secret", async () => {
    const studio = await open("writes-list");
    const raw = secret();
    const id = await fx.writeKey(studio, {
      provider: "openai",
      name: "Bob's key",
      secret: raw,
      people: [studio.bob],
    });
    const listed = await keys.listProviderKeys(owner(studio));
    const text = JSON.stringify(listed);
    expect(text).toContain(id);
    expect(text).toContain("Bob Ruiz");
    expect(text).not.toContain(raw);
    expect(text).not.toContain("v1.");
    // Nothing of another studio's.
    for (const other of [ids.bTeam, ids.bBob, b.bob.email, a.bob.email]) {
      expect(text).not.toContain(other);
    }
  });

  // A write that loses a race: another write's row, not yet committed, is
  // invisible to this one's check, so its insert waits on the unique index
  // and fails when the other commits. The owner reads what the check would
  // have said, never the database's text.
  type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
  const race = async (
    rival: (tx: Tx) => Promise<unknown>,
    write: () => Promise<unknown>,
  ): Promise<unknown> => {
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let ready = () => {};
    const written = new Promise<void>((r) => {
      ready = r;
    });
    const rivalDone = db.$transaction(
      async (tx) => {
        await rival(tx);
        ready();
        await held;
      },
      { timeout: 10_000 },
    );
    await written;
    const outcome = write().then(
      () => null,
      (error: unknown) => error,
    );
    // Long enough for the write to pass its check and wait on the index.
    await new Promise((r) => setTimeout(r, 300));
    release();
    await rivalDone;
    return outcome;
  };
  const rivalKey = (
    studio: Studio,
    tx: Tx,
    key: { name: string; forTeam?: boolean; person?: string },
  ) =>
    tx.providerKey
      .create({
        data: {
          makerId: studio.makerId,
          provider: "openai",
          name: key.name,
          forTeam: key.forTeam ?? false,
          sealed: "rival",
          hint: "ival",
        },
        select: { id: true },
      })
      .then(async (row) => {
        if (!key.person) return;
        await tx.providerKeyAccess.create({
          data: {
            makerId: studio.makerId,
            keyId: row.id,
            provider: "openai",
            memberId: key.person,
          },
        });
      });

  it("a write that loses a race to another reads the check's refusal, not the database's text", async () => {
    const studio = await open("writes-race");
    const teamTaken = "The team has an OpenAI key already: replace that one.";

    const named = await race(
      (tx) => rivalKey(studio, tx, { name: "Raced" }),
      () =>
        keys.addProviderKey(owner(studio), {
          provider: "openai",
          name: "Raced",
          who: "people",
          memberIds: [studio.bob.memberId],
          key: secret(),
        }),
    );
    expect(named).toBeInstanceOf(keys.KeyRefusal);
    expect(named).toMatchObject({
      message: "Another OpenAI key has that name.",
      field: "name",
    });

    const given = await race(
      (tx) =>
        rivalKey(studio, tx, {
          name: "Carla's other key",
          person: studio.carla.memberId,
        }),
      () =>
        keys.addProviderKey(owner(studio), {
          provider: "openai",
          name: "Carla's key",
          who: "people",
          memberIds: [studio.carla.memberId],
          key: secret(),
        }),
    );
    expect(given).toBeInstanceOf(keys.KeyRefusal);
    expect(given).toMatchObject({
      message:
        "Someone you chose was just given another OpenAI key: try again.",
      field: "memberIds",
    });

    const bobs = await keyNamed(studio, "Raced");
    const renamed = await race(
      (tx) => rivalKey(studio, tx, { name: "Renamed" }),
      () =>
        keys.editProviderKey(owner(studio), {
          keyId: bobs?.id ?? "",
          name: "Renamed",
          who: "people",
          memberIds: [studio.bob.memberId],
        }),
    );
    expect(renamed).toBeInstanceOf(keys.KeyRefusal);
    expect(renamed).toMatchObject({
      message: "Another OpenAI key has that name.",
      field: "name",
    });

    const team = await race(
      (tx) => rivalKey(studio, tx, { name: "Rival team", forTeam: true }),
      () =>
        keys.addProviderKey(owner(studio), {
          provider: "openai",
          name: "Our team key",
          who: "team",
          memberIds: [],
          key: secret(),
        }),
    );
    expect(team).toBeInstanceOf(keys.KeyRefusal);
    expect(team).toMatchObject({ message: teamTaken });
  });

  // Every write drops the studio's cached keys before it returns, and only
  // that studio's.
  it("after a key is given to Bob his next work runs on it; after it is taken away, on the team's; another studio's cache is untouched", async () => {
    const studio = await open("writes-cache");
    const other = await open("writes-cache-other");
    const team = secret();
    await fx.writeKey(studio, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: team,
    });
    const otherTeam = secret();
    const otherId = await fx.writeKey(other, {
      provider: "openai",
      name: "Team key",
      forTeam: true,
      secret: otherTeam,
    });
    const bobs = () =>
      keys.withMakerKeys(studio.as(studio.bob), async () =>
        providerKey("openai"),
      );
    const others = () =>
      keys.withMakerKeys(other.as(), async () => providerKey("openai"));
    // Both studios read once, so both are cached.
    expect(await bobs()).toBe(team);
    expect(await others()).toBe(otherTeam);
    // The other studio's row changes behind the cache's back: its cached
    // entry is what a write elsewhere must leave alone.
    await db.providerKey.delete({ where: { id: otherId } });

    const given = secret();
    await keys.addProviderKey(owner(studio), {
      provider: "openai",
      name: "Bob's key",
      who: "people",
      memberIds: [studio.bob.memberId],
      key: given,
    });
    expect(await bobs()).toBe(given);
    const bobsKey = await keyNamed(studio, "Bob's key");
    await keys.removeProviderKey(owner(studio), bobsKey?.id ?? "");
    expect(await bobs()).toBe(team);
    expect(await others()).toBe(otherTeam);
  });
});

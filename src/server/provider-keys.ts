import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import { assertDatabaseUrl, db, hasDatabase } from "@/lib/db";
import { keyProblem } from "@/lib/provider-key-forms";
import {
  type AccessRow,
  type KeyRow,
  type PickedKey,
  pickProviderKeys,
} from "@/lib/provider-key-pick";
import { article } from "@/lib/provider-key-words";
import {
  hasEnvironmentKey,
  type ProviderKeyIds,
  type ProviderKeys,
  providerKeySource,
  withProviderKeys,
} from "@/providers/keys";
import type { MakerRef } from "@/server/maker-repository";
import { roleOf } from "@/server/organization";
import { hasSecretKey, seal, unseal } from "@/server/secret-box";

// The provider keys each maker saved in Settings → Providers: sealed in the
// database, handed to the engine per piece of work (withMakerKeys), never
// sent back to the browser. They are the only keys the app uses; the
// environment's (OPENAI_API_KEY, GOOGLE_API_KEY) serve scripts and the CLI.

const PROVIDERS: ProviderId[] = ["openai", "google"];
const purpose = (provider: ProviderId) => `provider-key:${provider}`;

export interface ProviderKeyState {
  provider: ProviderId;
  // Where the key in use comes from; null when there is none.
  source: "saved" | "env" | null;
  // The saved key's last four characters.
  hint: string | null;
  // A key is saved but cannot be read (KILN_SECRET_KEY is missing or changed).
  unreadable: boolean;
  // The environment holds a key for this provider, which the app does not
  // use: it has to be saved here.
  inEnvironment: boolean;
}

// A studio's keys as the lookup reads them: every key row unsealed (null when
// it cannot be read), who each key is given to, and which of those people
// are on the studio's team.
interface StudioKeys {
  keys: KeyRow[];
  access: AccessRow[];
  people: string[];
}

// Each studio's keys, read once and unsealed in memory, keyed by the maker's
// id only; the key a caller runs on is picked per call from that one entry
// (pickProviderKeys), so the cache never hands one person's key to another.
// Every write of a studio's keys drops its entry, and a failed read is tried
// again. The cache is per server process: Kiln runs one (the worker lives in
// it); a second process would keep its own entry until its next read after a
// write of its own.
const cache = globalThis as typeof globalThis & {
  __kilnStudioKeys?: Map<string, Promise<StudioKeys>>;
};
const loaded = () => {
  cache.__kilnStudioKeys ??= new Map();
  return cache.__kilnStudioKeys;
};

// The key, or null when KILN_SECRET_KEY is missing or changed.
function unsealed(sealed: string, provider: ProviderId): string | null {
  try {
    return unseal(sealed, purpose(provider));
  } catch {
    return null;
  }
}

async function read(maker: MakerRef): Promise<StudioKeys> {
  const rows = await db.providerKey.findMany({
    where: { makerId: maker.id },
  });
  const access = await db.providerKeyAccess.findMany({
    where: { makerId: maker.id },
  });
  // An access row counts only for someone on this studio's team.
  const named = [...new Set(access.map((a) => a.memberId))];
  const people =
    named.length === 0
      ? []
      : await db.member.findMany({
          where: {
            id: { in: named },
            organization: { maker: { is: { id: maker.id } } },
          },
          select: { id: true },
        });
  const keys: KeyRow[] = [];
  for (const row of rows) {
    const provider = row.provider as ProviderId;
    if (!PROVIDERS.includes(provider)) continue;
    const secret = unsealed(row.sealed, provider);
    keys.push({ id: row.id, provider, forTeam: row.forTeam, secret });
  }
  return {
    keys,
    access: access.flatMap((a) =>
      PROVIDERS.includes(a.provider as ProviderId)
        ? [
            {
              keyId: a.keyId,
              memberId: a.memberId,
              provider: a.provider as ProviderId,
            },
          ]
        : [],
    ),
    people: people.map((p) => p.id),
  };
}

const NO_KEYS: StudioKeys = { keys: [], access: [], people: [] };

function studioKeys(maker: MakerRef): Promise<StudioKeys> {
  if (!hasDatabase()) return Promise.resolve(NO_KEYS);
  const entries = loaded();
  let pending = entries.get(maker.id);
  if (!pending) {
    pending = read(maker).catch((error) => {
      entries.delete(maker.id);
      throw error;
    });
    entries.set(maker.id, pending);
  }
  return pending;
}

const forget = (makerId: string) => loaded().delete(makerId);

// The key each provider gives this caller: the person's own, else the
// team's (a token, with no person, the team's only).
async function picked(maker: MakerRef) {
  return pickProviderKeys({
    ...(await studioKeys(maker)),
    memberId: maker.member?.id ?? null,
  });
}

// Run `work` with this caller's keys, and no one else's: the person's own or
// the team's, per provider, with the id of each key in use.
export async function withMakerKeys<T>(
  maker: MakerRef,
  work: () => Promise<T>,
): Promise<T> {
  const keys: ProviderKeys = {};
  const ids: ProviderKeyIds = {};
  for (const [provider, pick] of Object.entries(await picked(maker))) {
    if (!pick.key) continue;
    keys[provider as ProviderId] = pick.key.secret;
    ids[provider as ProviderId] = pick.key.id;
  }
  return withProviderKeys(keys, work, ids);
}

// Run a queued job on the keys of whoever queued it, picked now, not when it
// was queued. The person is read for each job, uncached, and only on the
// job's studio's team; one no longer on it gets no key at all, and `work`
// hears they left. A job with no person runs on the team's key. The ids come
// from a claimed row (claimJobs, under a lease), never from a client.
export async function withStarterKeys<T>(
  job: { makerId: string; memberId: string | null },
  work: (starter: "here" | "left") => Promise<T>,
): Promise<T> {
  if (!job.memberId || !hasDatabase()) {
    return withMakerKeys({ id: job.makerId }, () => work("here"));
  }
  const member = await db.member.findFirst({
    where: {
      id: job.memberId,
      organization: { maker: { is: { id: job.makerId } } },
    },
    select: { id: true, userId: true, role: true },
  });
  if (!member) return withProviderKeys({}, () => work("left"));
  return withMakerKeys(
    {
      id: job.makerId,
      member: {
        id: member.id,
        userId: member.userId,
        role: roleOf(member.role),
      },
    },
    () => work("here"),
  );
}

// Run `work` with one key of the studio's and no other, whoever it is given
// to: the owner checks a key that is not the one their own calls run on. The
// key is read under the studio (an id of another studio's reads as gone).
export async function withKey<T>(
  maker: MakerRef,
  keyId: string,
  work: (provider: ProviderId) => Promise<T>,
): Promise<T> {
  const key = (await studioKeys(maker)).keys.find((k) => k.id === keyId);
  if (!key) throw new KeyRefusal(KEY_GONE);
  return withProviderKeys(
    key.secret === null ? {} : { [key.provider]: key.secret },
    () => work(key.provider),
    { [key.provider]: key.id },
  );
}

// Whether each provider has a key this caller can use, and whose it is: no
// id, name or last four, so it may reach any reader's words.
export async function providerReach(
  maker: MakerRef,
): Promise<Record<ProviderId, Pick<PickedKey, "reach" | "whose">>> {
  const picks = await picked(maker);
  return {
    openai: { reach: picks.openai.reach, whose: picks.openai.whose },
    google: { reach: picks.google.reach, whose: picks.google.whose },
  };
}

export async function providerKeyStates(
  maker: MakerRef,
): Promise<ProviderKeyState[]> {
  const rows = hasDatabase()
    ? await db.providerKey.findMany({
        where: { makerId: maker.id, forTeam: true },
      })
    : [];
  // Today's form manages each provider's team key: the one a token runs on.
  const team = await picked({ id: maker.id });
  const keys: ProviderKeys = {};
  for (const provider of PROVIDERS) {
    const key = team[provider].key;
    if (key) keys[provider] = key.secret;
  }
  return withProviderKeys(keys, () =>
    PROVIDERS.map((provider) => {
      const row = rows.find((r) => r.provider === provider);
      const source = providerKeySource(provider);
      return {
        provider,
        source,
        hint: row?.hint ?? null,
        unreadable: Boolean(row) && source !== "saved",
        inEnvironment: hasEnvironmentKey(provider),
      };
    }),
  );
}

// A refusal of a write of the studio's keys, in the owner's words; `field`
// is the form's field it belongs under, if one.
export class KeyRefusal extends Error {
  constructor(
    message: string,
    readonly field?: "name" | "memberIds" | "key",
  ) {
    super(message);
    this.name = "KeyRefusal";
  }
}

const KEY_GONE = "That key was removed already.";

const nameTaken = (label: string) =>
  new KeyRefusal(`Another ${label} key has that name.`, "name");
const teamTaken = (label: string) =>
  new KeyRefusal(
    `The team has ${article(label)} ${label} key already: replace that one.`,
  );

// The unique index a refused write broke, as the driver adapter reports it.
const UniqueIndex = z.object({
  driverAdapterError: z.object({
    cause: z.object({ constraint: z.object({ index: z.string() }) }),
  }),
});

// A write that lost a race to another: the database's unique index refused
// what the check before it passed (the other's row was not yet committed),
// and the owner reads what the check would have said.
async function orRefused<T>(
  provider: ProviderId,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    const label = PROVIDER_LABELS[provider];
    const index = UniqueIndex.safeParse(error.meta).data?.driverAdapterError
      .cause.constraint.index;
    if (index === "ProviderKey_makerId_provider_name_key") {
      throw nameTaken(label);
    }
    if (index === "ProviderKey_one_team_key") throw teamTaken(label);
    if (index === "ProviderKeyAccess_makerId_memberId_provider_key") {
      throw new KeyRefusal(
        `Someone you chose was just given another ${label} key: try again.`,
        "memberIds",
      );
    }
    throw error;
  }
}

// A pasted key, sealed under its provider's purpose, with its last four.
function sealedKey(provider: ProviderId, raw: string) {
  const key = raw.trim();
  const problem = keyProblem(key);
  if (problem) throw new KeyRefusal(problem, "key");
  if (!hasSecretKey()) {
    throw new Error(
      `Kiln has no KILN_SECRET_KEY to keep the ${PROVIDER_LABELS[provider]} key sealed: add one to .env (openssl rand -base64 32) and restart Kiln.`,
    );
  }
  return { sealed: seal(key, purpose(provider)), hint: key.slice(-4) };
}

export async function saveProviderKey(
  maker: MakerRef,
  provider: ProviderId,
  raw: string,
): Promise<void> {
  assertDatabaseUrl();
  const data = sealedKey(provider, raw);
  // The form writes the provider's team key: replaced in place, or made,
  // named "Team key" unless another key has that name.
  await orRefused(provider, () =>
    db.$transaction(async (tx) => {
      const team = await tx.providerKey.findFirst({
        where: { makerId: maker.id, provider, forTeam: true },
        select: { id: true },
      });
      if (team) {
        await tx.providerKey.update({ where: { id: team.id }, data });
        return;
      }
      const name = "Team key";
      await refuseTaken(maker, tx, { provider, name, who: "team" }, null);
      await tx.providerKey.create({
        data: { makerId: maker.id, provider, name, forTeam: true, ...data },
      });
    }),
  );
  forget(maker.id);
}

export async function removeProviderKey(
  maker: MakerRef,
  provider: ProviderId,
): Promise<void> {
  assertDatabaseUrl();
  await db.providerKey.deleteMany({
    where: { makerId: maker.id, provider, forTeam: true },
  });
  forget(maker.id);
}

// Who uses a key: the whole team, or the people chosen (member ids from the
// client, checked against the studio's team before anything is written).
export interface KeyAudience {
  name: string;
  who: "team" | "people";
  memberIds: string[];
}

type Tx = Prisma.TransactionClient;

// The people chosen, each on this studio's team; anyone who is not (gone
// meanwhile, or of another studio) refuses the whole write.
async function chosenPeople(
  maker: MakerRef,
  tx: Tx,
  audience: KeyAudience,
): Promise<string[]> {
  if (audience.who === "team") return [];
  const ids = [...new Set(audience.memberIds)];
  if (ids.length === 0) {
    throw new KeyRefusal("Choose at least one person.", "memberIds");
  }
  const found = await tx.member.findMany({
    where: {
      id: { in: ids },
      organization: { maker: { is: { id: maker.id } } },
    },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new KeyRefusal(
      "Someone you chose is no longer on the team.",
      "memberIds",
    );
  }
  return ids;
}

// The name, and the team's place, are free among the provider's other keys.
async function refuseTaken(
  maker: MakerRef,
  tx: Tx,
  input: { provider: ProviderId; name: string; who: "team" | "people" },
  except: string | null,
): Promise<void> {
  const label = PROVIDER_LABELS[input.provider];
  const others = except === null ? {} : { id: { not: except } };
  const named = await tx.providerKey.findFirst({
    where: {
      makerId: maker.id,
      provider: input.provider,
      name: input.name,
      ...others,
    },
    select: { id: true },
  });
  if (named) throw nameTaken(label);
  if (input.who !== "team") return;
  const team = await tx.providerKey.findFirst({
    where: {
      makerId: maker.id,
      provider: input.provider,
      forTeam: true,
      ...others,
    },
    select: { id: true },
  });
  if (team) throw teamTaken(label);
}

// Give the key to exactly these people. A person holds one given key per
// provider: one on another key of the provider moves to this one.
async function giveKey(
  maker: MakerRef,
  tx: Tx,
  key: { id: string; provider: ProviderId },
  people: string[],
): Promise<void> {
  await tx.providerKeyAccess.deleteMany({
    where: { makerId: maker.id, keyId: key.id },
  });
  if (people.length === 0) return;
  await tx.providerKeyAccess.deleteMany({
    where: {
      makerId: maker.id,
      provider: key.provider,
      memberId: { in: people },
    },
  });
  await tx.providerKeyAccess.createMany({
    data: people.map((memberId) => ({
      makerId: maker.id,
      keyId: key.id,
      provider: key.provider,
      memberId,
    })),
  });
}

// The key, read under its studio; another studio's id reads as gone.
async function keyOf(
  maker: MakerRef,
  tx: Tx,
  keyId: string,
): Promise<{ id: string; provider: ProviderId }> {
  const key = await tx.providerKey.findFirst({
    where: { id: keyId, makerId: maker.id },
    select: { id: true, provider: true },
  });
  if (!key || !PROVIDERS.includes(key.provider as ProviderId)) {
    throw new KeyRefusal(KEY_GONE);
  }
  return { id: key.id, provider: key.provider as ProviderId };
}

// A new key, named, for the whole team or given to people.
export async function addProviderKey(
  maker: MakerRef,
  input: KeyAudience & { provider: ProviderId; key: string },
): Promise<{ id: string }> {
  assertDatabaseUrl();
  const name = input.name.trim();
  const data = sealedKey(input.provider, input.key);
  const added = await orRefused(input.provider, () =>
    db.$transaction(async (tx) => {
      await refuseTaken(maker, tx, { ...input, name }, null);
      const people = await chosenPeople(maker, tx, input);
      const row = await tx.providerKey.create({
        data: {
          makerId: maker.id,
          provider: input.provider,
          name,
          forTeam: input.who === "team",
          ...data,
        },
        select: { id: true },
      });
      await giveKey(
        maker,
        tx,
        { id: row.id, provider: input.provider },
        people,
      );
      return row;
    }),
  );
  forget(maker.id);
  return added;
}

// A key's name, and whom it is for. Switching it to the whole team drops its
// people.
export async function editProviderKey(
  maker: MakerRef,
  input: KeyAudience & { keyId: string },
): Promise<void> {
  assertDatabaseUrl();
  const name = input.name.trim();
  await db.$transaction(async (tx) => {
    const key = await keyOf(maker, tx, input.keyId);
    await refuseTaken(
      maker,
      tx,
      { provider: key.provider, name, who: input.who },
      key.id,
    );
    const people = await chosenPeople(maker, tx, input);
    await orRefused(key.provider, async () => {
      await tx.providerKey.update({
        where: { id: key.id, makerId: maker.id },
        data: { name, forTeam: input.who === "team" },
      });
      await giveKey(maker, tx, key, people);
    });
  });
  forget(maker.id);
}

// A new secret on the same key: its id, name and people stay. A key that
// cannot be read can be replaced; that is the fix.
export async function replaceProviderKey(
  maker: MakerRef,
  input: { keyId: string; key: string },
): Promise<void> {
  assertDatabaseUrl();
  await db.$transaction(async (tx) => {
    const key = await keyOf(maker, tx, input.keyId);
    await tx.providerKey.update({
      where: { id: key.id, makerId: maker.id },
      data: sealedKey(key.provider, input.key),
    });
  });
  forget(maker.id);
}

// Remove a key; who it was given to goes with it (the database's cascade).
export async function removeProviderKeyById(
  maker: MakerRef,
  keyId: string,
): Promise<void> {
  assertDatabaseUrl();
  await db.$transaction(async (tx) => {
    const key = await keyOf(maker, tx, keyId);
    await tx.providerKey.delete({
      where: { id: key.id, makerId: maker.id },
    });
  });
  forget(maker.id);
}

export interface ProviderKeyListing {
  id: string;
  provider: ProviderId;
  name: string;
  forTeam: boolean;
  hint: string;
  // Whether KILN_SECRET_KEY can open it.
  readable: boolean;
  // Whom it is given to, named only from the studio's own team.
  people: { memberId: string; name: string; email: string }[];
}

// Every key of the studio with its people, for the owner's list: never the
// key itself, only its last four.
export async function listProviderKeys(
  maker: MakerRef,
): Promise<ProviderKeyListing[]> {
  if (!hasDatabase()) return [];
  const rows = await db.providerKey.findMany({
    where: { makerId: maker.id },
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
  });
  const access = await db.providerKeyAccess.findMany({
    where: { makerId: maker.id },
    orderBy: { createdAt: "asc" },
  });
  const team = await db.member.findMany({
    where: { organization: { maker: { is: { id: maker.id } } } },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  return rows.flatMap((row) => {
    const provider = row.provider as ProviderId;
    if (!PROVIDERS.includes(provider)) return [];
    return [
      {
        id: row.id,
        provider,
        name: row.name,
        forTeam: row.forTeam,
        hint: row.hint,
        readable: unsealed(row.sealed, provider) !== null,
        people: access
          .filter((a) => a.keyId === row.id)
          .flatMap((a) => {
            const person = team.find((p) => p.id === a.memberId);
            return person
              ? [
                  {
                    memberId: person.id,
                    name: person.user.name,
                    email: person.user.email,
                  },
                ]
              : [];
          }),
      },
    ];
  });
}

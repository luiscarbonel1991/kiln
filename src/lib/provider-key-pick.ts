import type { ProviderId } from "@/domain/model-defaults";

// Which of a studio's keys a caller's work runs on, per provider. A person
// (the owner or a member) runs on the key given to them for that provider,
// else on the team's, else on none; work with no person (a token, a job a
// token queued) on the team's only. An access row counts only for someone
// on the studio's team (`people`). The rows decide, not the secret: a key the
// rule picks that cannot be read (`secret` null) is no key, and the caller
// never moves to another one. The role plays no part.

export interface KeyRow {
  id: string;
  provider: ProviderId;
  forTeam: boolean;
  // The unsealed key, or null when it cannot be read.
  secret: string | null;
}

export interface AccessRow {
  keyId: string;
  memberId: string;
  provider: ProviderId;
}

// none: the studio has no key for the provider; not-yours: it has keys, none
// for this caller; unreadable: the caller's key cannot be read.
export type KeyReach = "none" | "not-yours" | "unreadable" | "in-reach";

export interface PickedKey {
  key: { id: string; secret: string } | null;
  whose: "given" | "team" | null;
  reach: KeyReach;
}

const PROVIDERS: ProviderId[] = ["openai", "google"];

function pickOne(
  provider: ProviderId,
  input: {
    keys: KeyRow[];
    access: AccessRow[];
    people: string[];
    memberId: string | null;
  },
): PickedKey {
  const keys = input.keys.filter((k) => k.provider === provider);
  if (keys.length === 0) return { key: null, whose: null, reach: "none" };
  const { memberId } = input;
  const onTeam = memberId !== null && input.people.includes(memberId);
  const givenId = onTeam
    ? input.access.find(
        (a) =>
          a.provider === provider &&
          a.memberId === memberId &&
          keys.some((k) => k.id === a.keyId),
      )?.keyId
    : undefined;
  const given = keys.find((k) => k.id === givenId);
  const picked = given ?? keys.find((k) => k.forTeam);
  if (!picked) return { key: null, whose: null, reach: "not-yours" };
  const whose = given ? "given" : "team";
  if (picked.secret === null) return { key: null, whose, reach: "unreadable" };
  return {
    key: { id: picked.id, secret: picked.secret },
    whose,
    reach: "in-reach",
  };
}

export function pickProviderKeys(input: {
  keys: KeyRow[];
  access: AccessRow[];
  people: string[];
  memberId: string | null;
}): Record<ProviderId, PickedKey> {
  return Object.fromEntries(
    PROVIDERS.map((provider) => [provider, pickOne(provider, input)]),
  ) as Record<ProviderId, PickedKey>;
}

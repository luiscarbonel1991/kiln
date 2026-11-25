// What Kiln says about a provider's key, by who reads it. `ask` is whom a
// member asks (the owner's first name, or "the studio's owner"); null is the
// owner, or work with no person behind it (a token, a script, the worker),
// which reads as the owner. A member never reads key material, an owner's
// control or where a key is set.

import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import { isKeyRejectedText } from "@/domain/queue";
import type { KeyReach } from "@/lib/provider-key-pick";

type KeyState = {
  provider: "openai" | "google";
  source: "saved" | "env" | null;
  hint: string | null;
  unreadable: boolean;
  inEnvironment: boolean;
};

const ENV_NAME = { openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };

export const article = (label: string) =>
  /^[aeiou]/i.test(label) ? "an" : "a";

const noAccess = (label: string) =>
  `You have no access to ${article(label)} ${label} key`;

export const noAccessLine = (label: string, ask: string) =>
  `${noAccess(label)}; ask ${ask}.`;

// A member's rejected key: the one the owner gave them, or the studio's.
const rejected = (label: string, ask: string, given?: boolean) =>
  `${label} rejected ${given ? `the key ${ask} gave you` : "the studio's key"} on its last call; ask ${ask}`;

export const providersIntro = (ask: string | null) =>
  ask === null
    ? "Kiln runs on your own keys: paste one and it is kept sealed on this machine, then checked for free (the provider lists its models, nothing is generated). One provider is enough to start. The rest is read from the last calls Kiln made."
    : `Kiln runs on the studio's keys, which ${ask} manages.`;

// Settings → Providers, a provider's key line. A key in reach is one the
// reader's calls would run on; a saved key that cannot be read is not. A
// member reads one thing about the key, and whether it was given to them or
// is the studio's (`given`), never its name or last four.
export function keyLine(input: {
  state: KeyState | undefined;
  owner: boolean;
  keyInReach: boolean;
  keyRejected?: boolean;
  given?: boolean;
  ask: string | null;
  label: string;
}): string {
  const { state, owner, keyInReach, keyRejected, given, ask, label } = input;
  if (ask !== null) {
    if (!keyInReach) return noAccessLine(label, ask);
    if (keyRejected) return `${rejected(label, ask, given)}.`;
    if (given === undefined) return `You can generate with ${label}.`;
    return `You can generate with ${label}, on ${given ? `a key ${ask} gave you` : "the studio's key"}.`;
  }
  if (!state) return "No API key yet";
  if (state.unreadable) {
    return `A saved key (ends in ${state.hint}) cannot be read: KILN_SECRET_KEY is missing or changed. Paste the key again.`;
  }
  if (state.source === "saved") return `API key saved, ends in ${state.hint}`;
  if (state.inEnvironment && owner) {
    return `No API key yet. ${ENV_NAME[state.provider]} is in .env, but the app uses only keys saved here: paste it below.`;
  }
  return "No API key yet";
}

// The owner's line above a provider's keys: which key their own calls run
// on (`keyName`, null when none is theirs or the team's).
export function ownCallsLine(input: {
  label: string;
  reach: KeyReach;
  keyName: string | null;
}): string {
  const { label, reach, keyName } = input;
  if (reach === "none") return `No ${label} key yet.`;
  if (reach === "not-yours" || keyName === null) {
    return `No ${label} key is yours or the team's, so your calls cannot use ${label}.`;
  }
  if (reach === "unreadable") {
    return `Your calls run on ${keyName}, which cannot be read now.`;
  }
  return `Your calls run on ${keyName}.`;
}

// The owner's note when the environment holds a key the app does not use.
export const envKeyLine = (provider: ProviderId) =>
  `${ENV_NAME[provider]} is in .env, but the app uses only keys saved here: add it below.`;

// One key in the owner's list: its name and last four, on one line.
export const keyRowTitle = (name: string, hint: string) =>
  `${name} · ends in ${hint}`;

// What the owner must know of one key under its title, or null when it
// works: it cannot be read, the provider rejected it, or nobody is left on it.
export function keyRowLine(input: {
  label: string;
  readable: boolean;
  keyRejected: boolean;
  forTeam: boolean;
  people: number;
}): string | null {
  if (!input.readable) {
    return "This key cannot be read: KILN_SECRET_KEY is missing or changed. Replace it.";
  }
  if (input.keyRejected) {
    return `${input.label} rejected this key on its last call: replace it.`;
  }
  if (!input.forTeam && input.people === 0) {
    return "Nobody can use this key now: give it to someone, or remove it.";
  }
  return null;
}

// "Bob", "Bob and Carla", "Bob, Carla and Dana".
const together = (names: string[]) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// The question before a key is removed: what follows for the people on it.
export function removeKeyLine(input: {
  label: string;
  name: string;
  forTeam: boolean;
  // The first names of the people the key is given to.
  people: string[];
  // Whether the provider has a team key they would fall back on.
  teamKey: boolean;
}): string {
  const { label, name, forTeam, people, teamKey } = input;
  if (forTeam) {
    return `Remove the team's ${label} key? Everyone without a key of their own will have no ${label} key.`;
  }
  if (people.length === 0) return `Remove ${name}?`;
  return teamKey
    ? `Remove ${name}? ${together(people)} will run on the team's key.`
    : `Remove ${name}? ${together(people)} will have no ${label} key.`;
}

// A provider's last error in Settings, under the key line. A member's key
// line already says a rejected key, so there is no second line (null).
export const healthErrorLine = (input: {
  message: string;
  keyRejected: boolean;
  label: string;
  ask: string | null;
}): string | null =>
  input.keyRejected && input.ask !== null ? null : input.message;

// What a stored failure tells its reader to do about the key or the
// provider's account: the owner's to do, not a member's.
const OWNERS_TO_DO =
  /replace the key|Settings|\.env|_API_KEY|billing|spend cap|AI Studio|ai\.studio|platform\.openai\.com/i;

// One stored failure in a member's words: a rejected key is the studio's, and
// what only the owner can do becomes whom to ask; anything else as stored.
const inMembersWords = (
  label: string,
  message: string,
  keyRejected: boolean | undefined,
  ask: string,
  given?: boolean,
) =>
  keyRejected
    ? `${rejected(label, ask, given)}.`
    : OWNERS_TO_DO.test(message)
      ? `${label}'s last call failed; ask ${ask}.`
      : message;

// A provider's health in its reader's words, for a page and for what it hands
// the browser: a member reads whom to ask where the stored failure says what
// only the owner can do, and keeps whether their key was given to them, but
// not why a key is out of reach (`reach` is the owner's). The owner (null)
// gets the health as it was given.
export function healthForReader<
  T extends {
    provider: ProviderId;
    lastError: { message: string } | null;
    keyRejected?: boolean;
    reach?: KeyReach;
    given?: boolean;
  },
>(
  health: T[],
  ask: string | null,
): (Omit<T, "reach"> & { reach?: KeyReach })[] {
  if (ask === null) return health;
  return health.map(({ reach: _reach, ...h }) => {
    if (!h.lastError) return h;
    const message = inMembersWords(
      PROVIDER_LABELS[h.provider],
      h.lastError.message,
      h.keyRejected,
      ask,
      h.given,
    );
    return { ...h, lastError: { ...h.lastError, message } };
  });
}

// A frame's failure as its reader reads it, by the rule of healthForReader:
// the owner and a token (null) as stored, a member in their words. Kiln's own
// "Not run: " sentences name no one and read the same for everyone.
export const failureForReader = (
  message: string,
  provider: ProviderId,
  ask: string | null,
): string =>
  ask === null
    ? message
    : inMembersWords(
        PROVIDER_LABELS[provider],
        message,
        isKeyRejectedText(message),
        ask,
      );

// Home, when no provider can run for the reader. The owner's ends on "add
// one in Settings", which the page makes the link; with keys in the studio,
// none theirs or the team's, it says the key must be.
export const HOME_KEYS_LINK = "add one in Settings";

export function homeKeysLine(
  ask: string | null,
  reach?: Record<ProviderId, KeyReach>,
): string {
  const free = "Exact frames, vectors and the plan need no key.";
  if (ask !== null) {
    return `${free} Scenes, video and written text need one of the studio's keys; ask ${ask}.`;
  }
  const keysExist = reach && Object.values(reach).some((r) => r !== "none");
  return keysExist
    ? `${free} Scenes, video and written text need an OpenAI or Google key that is yours or the team's: ${HOME_KEYS_LINK}.`
    : `${free} Scenes, video and written text run on your own OpenAI or Google key: ${HOME_KEYS_LINK}.`;
}

// Why the owner, or a token (which runs on the team's key only), has no key
// of a provider in reach; `reach` is theirs, absent when unknown. With no key
// in the studio it is the line of before.
type Reader = { reach?: KeyReach; token?: boolean };

function noKeyReason(label: string, { reach, token }: Reader): string {
  if (reach === "not-yours") {
    return token
      ? `${label} has no key for the whole team, the only one a token runs on: add one in Settings → Providers`
      : `no ${label} key is yours or the team's: add one in Settings → Providers`;
  }
  if (reach === "unreadable") {
    return token
      ? `the team's ${label} key cannot be read: replace it in Settings → Providers`
      : `the ${label} key your calls run on cannot be read: replace it in Settings → Providers`;
  }
  return `${label} has no API key: add one in Settings → Providers`;
}

const sentence = (reason: string) =>
  reason.charAt(0).toUpperCase() + reason.slice(1);

// Settings → Models, under a route's model whose provider has no key in reach.
export function routeKeyLine(
  label: string,
  ask: string | null,
  reader: Reader = {},
): string {
  if (ask !== null) {
    return `${noAccess(label)}, so this model cannot run; ask ${ask}.`;
  }
  if (reader.reach === "not-yours") {
    return `No ${label} key is yours or the team's (add one under Providers): this model cannot run.`;
  }
  if (reader.reach === "unreadable") {
    return `The ${label} key your calls run on cannot be read: this model cannot run.`;
  }
  return `${label} has no API key (add one under Providers): this model cannot run.`;
}

// The board's block on a card, before anyone clicks. The other provider is
// a way out only when it can run (`other` is its label, or null).
export const orPickLine = (other: string | null) =>
  other === null ? "." : `, or pick ${article(other)} ${other} model.`;

export const blockNoKeyLine = (
  label: string,
  other: string | null,
  ask: string,
) => `${noAccess(label)}; ask ${ask}${orPickLine(other)}`;

export const blockRejectedLine = (
  label: string,
  other: string | null,
  ask: string,
  given?: boolean,
) => `${rejected(label, ask, given)}${orPickLine(other)}`;

// The owner's block on a card whose provider has no key in reach for them.
export const blockOwnerNoKeyLine = (
  label: string,
  other: string | null,
  reach?: KeyReach,
) => `${sentence(noKeyReason(label, { reach }))}${orPickLine(other)}`;

// The queue's refusal of a card whose provider has no key in reach.
export const queueNoKeyLine = (
  card: string,
  model: string,
  label: string,
  ask: string | null,
  reader: Reader = {},
) =>
  ask === null
    ? `${card} uses ${model}, but ${noKeyReason(label, reader)}.`
    : `${card} uses ${model}, but you have no access to ${article(label)} ${label} key; ask ${ask}.`;

// A direct call refused for want of a key, inside the app.
export const directNoKeyLine = (
  label: string,
  ask: string | null,
  reader: Reader = {},
) =>
  ask === null
    ? `${sentence(noKeyReason(label, reader))}.`
    : noAccessLine(label, ask);

// What Kiln says about a provider's key, by who reads it. `ask` is whom a
// member asks (the owner's first name, or "the studio's owner"); null is the
// owner, or work with no person behind it (a token, a script, the worker),
// which reads as the owner. A member never reads key material, an owner's
// control or where a key is set.

import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import { isKeyRejectedText } from "@/domain/queue";

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

const rejected = (label: string, ask: string) =>
  `${label} rejected the studio's key on its last call; ask ${ask}`;

export const providersIntro = (ask: string | null) =>
  ask === null
    ? "Kiln runs on your own keys: paste one and it is kept sealed on this machine, then checked for free (the provider lists its models, nothing is generated). One provider is enough to start. The rest is read from the last calls Kiln made."
    : `Kiln runs on the studio's keys, which ${ask} manages.`;

// Settings → Providers, a provider's key line. A key in reach is one the
// reader's calls would run on; a saved key that cannot be read is not. A
// member reads one thing about the key: a rejected one cannot generate.
export function keyLine(input: {
  state: KeyState | undefined;
  owner: boolean;
  keyInReach: boolean;
  keyRejected?: boolean;
  ask: string | null;
  label: string;
}): string {
  const { state, owner, keyInReach, keyRejected, ask, label } = input;
  if (ask !== null) {
    if (!keyInReach) return noAccessLine(label, ask);
    if (keyRejected) return `${rejected(label, ask)}.`;
    return `You can generate with ${label}.`;
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
) =>
  keyRejected
    ? `${rejected(label, ask)}.`
    : OWNERS_TO_DO.test(message)
      ? `${label}'s last call failed; ask ${ask}.`
      : message;

// A provider's health in its reader's words, for a page and for what it hands
// the browser: a member reads whom to ask where the stored failure says what
// only the owner can do. The owner (null) gets the health as it was given.
export function healthForReader<
  T extends {
    provider: ProviderId;
    lastError: { message: string } | null;
    keyRejected?: boolean;
  },
>(health: T[], ask: string | null): T[] {
  if (ask === null) return health;
  return health.map((h) => {
    if (!h.lastError) return h;
    const message = inMembersWords(
      PROVIDER_LABELS[h.provider],
      h.lastError.message,
      h.keyRejected,
      ask,
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

// Home, for a member with no key in reach (the owner's line has a link to
// Settings and stays in the page).
export const homeKeysLine = (ask: string) =>
  `Exact frames, vectors and the plan need no key. Scenes, video and written text need one of the studio's keys; ask ${ask}.`;

// Settings → Models, under a route's model whose provider has no key in reach.
export const routeKeyLine = (label: string, ask: string | null) =>
  ask === null
    ? `${label} has no API key (add one under Providers): this model cannot run.`
    : `${noAccess(label)}: this model cannot run.`;

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
) => `${rejected(label, ask)}${orPickLine(other)}`;

// The queue's refusal of a card whose provider has no key in reach.
export const queueNoKeyLine = (
  card: string,
  model: string,
  label: string,
  ask: string | null,
) =>
  ask === null
    ? `${card} uses ${model}, but ${label} has no API key: add one in Settings → Providers.`
    : `${card} uses ${model}, but you have no access to ${article(label)} ${label} key; ask ${ask}.`;

// A direct call refused for want of a key, inside the app.
export const directNoKeyLine = (label: string, ask: string | null) =>
  ask === null
    ? `${label} has no API key: add one in Settings → Providers.`
    : noAccessLine(label, ask);

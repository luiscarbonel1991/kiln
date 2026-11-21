// What Kiln says about a provider's key, by who reads it. `ask` is whom a
// member asks (the owner's first name, or "the studio's owner"); null is the
// owner, or work with no person behind it (a token, a script, the worker),
// which reads as the owner. A member never reads key material, an owner's
// control or where a key is set.

type KeyState = {
  provider: "openai" | "google";
  source: "saved" | "env" | null;
  hint: string | null;
  unreadable: boolean;
  inEnvironment: boolean;
};

const ENV_NAME = { openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };

const article = (label: string) => (/^[aeiou]/i.test(label) ? "an" : "a");

const noAccess = (label: string) =>
  `You have no access to ${article(label)} ${label} key`;

export const noAccessLine = (label: string, ask: string) =>
  `${noAccess(label)}; ask ${ask}.`;

export const providersIntro = (ask: string | null) =>
  ask === null
    ? "Kiln runs on your own keys: paste one and it is kept sealed on this machine, then checked for free (the provider lists its models, nothing is generated). One provider is enough to start. The rest is read from the last calls Kiln made."
    : `Kiln runs on the studio's keys, which ${ask} manages.`;

// Settings → Providers, a provider's key line. A key in reach is one the
// reader's calls would run on; a saved key that cannot be read is not.
export function keyLine(input: {
  state: KeyState | undefined;
  owner: boolean;
  keyInReach: boolean;
  ask: string | null;
  label: string;
}): string {
  const { state, owner, keyInReach, ask, label } = input;
  if (ask !== null) {
    return keyInReach
      ? `You can generate with ${label}.`
      : noAccessLine(label, ask);
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

// A provider's last error in Settings. Only a rejected key reads differently
// for a member: replacing it is the owner's to do.
export const healthErrorLine = (input: {
  message: string;
  keyRejected: boolean;
  label: string;
  ask: string | null;
}): string =>
  input.keyRejected && input.ask !== null
    ? `${input.label} rejected the studio's key on its last call; ask ${input.ask}.`
    : input.message;

// Home, for a member with no key in reach (the owner's line has a link to
// Settings and stays in the page).
export const homeKeysLine = (ask: string) =>
  `Exact frames, vectors and the plan need no key. Scenes, video and written text need one of the studio's keys; ask ${ask}.`;

// Settings → Models, under a route's model whose provider has no key in reach.
export const routeKeyLine = (label: string, ask: string | null) =>
  ask === null
    ? `${label} has no API key (add one under Providers): this model cannot run.`
    : `${noAccess(label)}: this model cannot run.`;

// The board's block on a card, before anyone clicks.
export const blockNoKeyLine = (label: string, other: string, ask: string) =>
  `${noAccess(label)}; ask ${ask}, or pick ${other} model.`;

export const blockRejectedLine = (label: string, other: string, ask: string) =>
  `${label} rejected the studio's key on its last call; ask ${ask}, or pick ${other} model.`;

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

"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  modelLabel,
  PROVIDER_LABELS,
  type ProviderId,
} from "@/domain/model-defaults";
import { AgentRoutes, MakerRoutes } from "@/domain/model-routing";
import { isKeyRejectedText } from "@/domain/queue";
import {
  AddKeyForm,
  EditKeyForm,
  type KeyAnswer,
  type KeyField,
  KeyOfStudio,
  ReplaceKeyForm,
} from "@/lib/provider-key-forms";
import { MOCK_CALLS_LINE } from "@/lib/provider-key-words";
import type { KeyCheck } from "@/providers/key-check";
import { providerMode } from "@/providers/mode";
import { agentRoutesProblem } from "@/server/chat/agent-route";
import { makerAction, ownerAction } from "@/server/guarded";
import {
  type MakerRef,
  saveMakerRoutes,
  setSceneLook,
} from "@/server/maker-repository";
import { checkKey } from "@/server/provider-health";
import {
  addProviderKey,
  editProviderKey,
  KeyRefusal,
  removeProviderKey,
  replaceProviderKey,
} from "@/server/provider-keys";

const SavedRoutes = z.object({ routes: MakerRoutes, agents: AgentRoutes });

// Settings → Models: a route per role and the agents' own. Zod is the trust
// boundary: every model one Kiln offers for the route's kind, with a pinned
// price, once per route; an agent Kiln has, on models that read images when
// it looks at them.
export const saveMakerRoutesAction = makerAction(
  async (maker, input: unknown): Promise<{ error?: string }> => {
    const parsed = SavedRoutes.safeParse(input);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Pick a model for each role.",
      };
    }
    const problem = agentRoutesProblem(parsed.data.agents);
    if (problem) return { error: problem };
    try {
      await saveMakerRoutes(maker, parsed.data.routes, parsed.data.agents);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    refresh();
    return {};
  },
);

// A failed free check in Settings' own words: no status code, and no other
// provider to move to (that one may have no key). A key the provider
// rejected is said once, by its row's refreshed line: null here.
function failedCheckWords(
  provider: ProviderId,
  result: Extract<KeyCheck, { ok: false }>,
): string | null {
  const label = PROVIDER_LABELS[provider];
  const said = result.message;
  if (!result.called) {
    return providerMode() === "mock"
      ? MOCK_CALLS_LINE
      : "Kiln could not read the key: replace it.";
  }
  if (isKeyRejectedText(said)) return null;
  if (provider === "google" && /spend cap/i.test(said)) {
    return "Google is at its spend cap: raise it at ai.studio/spend, then check the key again.";
  }
  if (provider === "openai" && /out of quota/i.test(said)) {
    return "OpenAI is out of quota: see its billing at platform.openai.com, then check the key again.";
  }
  if (/rate-limiting/i.test(said)) {
    return `${label} is busy; check the key again in a minute.`;
  }
  return `Kiln could not check the key with ${label}; check it again in a minute.`;
}

// The free check's answer: the models the provider no longer lists, or why
// the check failed (null message: the row says it).
function checkedWords(
  provider: ProviderId,
  result: KeyCheck & { unlisted?: string[] },
): { ok: boolean; message: string | null } {
  if (!result.ok) {
    return { ok: false, message: failedCheckWords(provider, result) };
  }
  const label = PROVIDER_LABELS[provider];
  const gone = (result.unlisted ?? []).map((model) =>
    modelLabel({ provider, model }),
  );
  return {
    ok: true,
    message: gone.length
      ? `${label} accepts the key, but no longer lists ${gone.join(", ")}: Kiln will not run ${gone.length === 1 ? "it" : "them"}.`
      : `${label} accepts the key.`,
  };
}

// Settings → Providers, a studio's several keys: the owner's to manage, and
// to check. What the client sends is
// what the form holds (a key id, a name, whom it is for, member ids, a key),
// never who is asking; the functions read the key and the people again under
// this studio. An answer names the form field it belongs under, if one.

const KEY_FIELDS: readonly string[] = ["name", "who", "memberIds", "key"];
const MOCK_KEYS = "Mock mode calls no provider: add keys in a live run.";

function formProblem(
  issues: { path: PropertyKey[]; message: string }[],
): KeyAnswer {
  const issue = issues[0];
  const field = String(issue?.path[0] ?? "");
  return {
    ok: false,
    saved: false,
    message: issue?.message ?? "Fill in the form.",
    ...(KEY_FIELDS.includes(field) ? { field: field as KeyField } : {}),
  };
}

// What the owner reads when a key action fails for a reason that is not
// Kiln's own refusal (a database error, say): a fixed sentence, never the
// raw text.
const COULD_NOT = {
  save: "Kiln could not save the key; try again.",
  change: "Kiln could not save the change; try again.",
  check: "Kiln could not check the key; try again.",
  remove: "Kiln could not remove the key; try again.",
};

// The detail of such a failure, for the server's log only: its kind, its
// code and its words, with anything long enough to be a key masked before
// the words are cut short (a cut first could leave a key's start unmasked).
function logFailure(what: keyof typeof COULD_NOT, error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const said = error instanceof Error ? error.message : String(error);
  console.warn(
    `[kiln] a key action (${what}) failed:`,
    error instanceof Error ? error.name : typeof error,
    typeof code === "string" ? code : "",
    said.replace(/\S{20,}/g, "[masked]").slice(0, 500),
  );
}

function refused(what: keyof typeof COULD_NOT, error: unknown): KeyAnswer {
  if (error instanceof KeyRefusal) {
    return {
      ok: false,
      saved: false,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    };
  }
  logFailure(what, error);
  return { ok: false, saved: false, message: COULD_NOT[what] };
}

// A key just saved, checked for free so the owner reads the provider's
// answer; a key it rejects is "Saved." alone, as the row says the rest.
async function savedAndChecked(
  maker: MakerRef,
  keyId: string,
): Promise<KeyAnswer> {
  try {
    const result = await checkKey(maker, keyId);
    const { ok, message } = checkedWords(result.provider, result);
    if (message === null) return { ok, saved: true, message: "Saved." };
    return ok
      ? { ok, saved: true, message: `Saved. ${message}` }
      : { ok, saved: true, message: `Saved, but: ${message}` };
  } catch (error) {
    return {
      ok: false,
      saved: true,
      message: `Saved, but: ${refused("check", error).message}`,
    };
  }
}

export const addProviderKeyAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = AddKeyForm.safeParse(input);
    if (!parsed.success) return formProblem(parsed.error.issues);
    if (providerMode() === "mock")
      return { ok: false, saved: false, message: MOCK_KEYS };
    let added: { id: string };
    try {
      added = await addProviderKey(maker, parsed.data);
    } catch (error) {
      return refused("save", error);
    }
    const answer = await savedAndChecked(maker, added.id);
    refresh();
    return { ...answer, keyId: added.id };
  },
);

export const editProviderKeyAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = EditKeyForm.safeParse(input);
    if (!parsed.success) return formProblem(parsed.error.issues);
    try {
      await editProviderKey(maker, parsed.data);
    } catch (error) {
      return refused("change", error);
    }
    refresh();
    return { ok: true, saved: true, message: "Saved." };
  },
);

export const replaceProviderKeyAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = ReplaceKeyForm.safeParse(input);
    if (!parsed.success) return formProblem(parsed.error.issues);
    if (providerMode() === "mock")
      return { ok: false, saved: false, message: MOCK_KEYS };
    try {
      await replaceProviderKey(maker, parsed.data);
    } catch (error) {
      return refused("save", error);
    }
    const answer = await savedAndChecked(maker, parsed.data.keyId);
    refresh();
    return answer;
  },
);

export const checkProviderKeyAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = KeyOfStudio.safeParse(input);
    if (!parsed.success) {
      return { ok: false, saved: false, message: "Which key?" };
    }
    let result: Awaited<ReturnType<typeof checkKey>>;
    try {
      result = await checkKey(maker, parsed.data.keyId);
    } catch (error) {
      return refused("check", error);
    }
    if (result.called) refresh();
    // A key the provider rejected: the row's refreshed line says so.
    const { ok, message } = checkedWords(result.provider, result);
    return { ok, saved: false, message: message ?? "Checked." };
  },
);

export const removeProviderKeyAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = KeyOfStudio.safeParse(input);
    if (!parsed.success) {
      return { ok: false, saved: false, message: "Which key?" };
    }
    try {
      await removeProviderKey(maker, parsed.data.keyId);
    } catch (error) {
      return refused("remove", error);
    }
    refresh();
    return { ok: true, saved: false, message: "Removed." };
  },
);

// Settings → Checks: the paid look at every scene, on or off.
export const setSceneLookAction = makerAction(
  async (maker, input: unknown): Promise<{ error?: string }> => {
    const parsed = z.boolean().safeParse(input);
    if (!parsed.success) return { error: "On or off?" };
    try {
      await setSceneLook(maker, parsed.data);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    refresh();
    return {};
  },
);

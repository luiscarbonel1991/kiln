"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  modelLabel,
  PROVIDER_LABELS,
  type ProviderId,
} from "@/domain/model-defaults";
import { AgentRoutes, MakerRoutes } from "@/domain/model-routing";
import {
  AddKeyForm,
  EditKeyForm,
  type KeyAnswer,
  type KeyField,
  KeyOfStudio,
  ReplaceKeyForm,
} from "@/lib/provider-key-forms";
import type { KeyCheck } from "@/providers/key-check";
import { providerMode } from "@/providers/mode";
import { agentRoutesProblem } from "@/server/chat/agent-route";
import { makerAction, ownerAction } from "@/server/guarded";
import {
  type MakerRef,
  saveMakerRoutes,
  setSceneLook,
} from "@/server/maker-repository";
import { checkKeyById } from "@/server/provider-health";
import {
  addProviderKey,
  editProviderKey,
  KeyRefusal,
  removeProviderKeyById,
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

// The free check's answer, in the provider's own words.
function checkedWords(
  provider: ProviderId,
  result: KeyCheck & { unlisted?: string[] },
): KeyAnswer {
  if (!result.ok) return { ok: false, saved: false, message: result.message };
  const label = PROVIDER_LABELS[provider];
  const gone = (result.unlisted ?? []).map((model) =>
    modelLabel({ provider, model }),
  );
  return {
    ok: true,
    saved: false,
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

function refused(error: unknown): KeyAnswer {
  return {
    ok: false,
    saved: false,
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof KeyRefusal && error.field
      ? { field: error.field }
      : {}),
  };
}

// A key just saved, checked for free so the owner reads the provider's own
// answer.
async function savedAndChecked(
  maker: MakerRef,
  keyId: string,
): Promise<KeyAnswer> {
  try {
    const result = await checkKeyById(maker, keyId);
    const checked = checkedWords(result.provider, result);
    return checked.ok
      ? { ok: true, saved: true, message: `Saved. ${checked.message}` }
      : { ok: false, saved: true, message: `Saved, but: ${checked.message}` };
  } catch (error) {
    return {
      ok: false,
      saved: true,
      message: `Saved, but: ${refused(error).message}`,
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
      return refused(error);
    }
    const answer = await savedAndChecked(maker, added.id);
    refresh();
    return answer;
  },
);

export const editProviderKeyAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = EditKeyForm.safeParse(input);
    if (!parsed.success) return formProblem(parsed.error.issues);
    try {
      await editProviderKey(maker, parsed.data);
    } catch (error) {
      return refused(error);
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
      return refused(error);
    }
    const answer = await savedAndChecked(maker, parsed.data.keyId);
    refresh();
    return answer;
  },
);

export const checkProviderKeyByIdAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = KeyOfStudio.safeParse(input);
    if (!parsed.success) {
      return { ok: false, saved: false, message: "Which key?" };
    }
    let result: Awaited<ReturnType<typeof checkKeyById>>;
    try {
      result = await checkKeyById(maker, parsed.data.keyId);
    } catch (error) {
      return refused(error);
    }
    if (result.called) refresh();
    return checkedWords(result.provider, result);
  },
);

export const removeProviderKeyByIdAction = ownerAction(
  async (maker, input: unknown): Promise<KeyAnswer> => {
    const parsed = KeyOfStudio.safeParse(input);
    if (!parsed.success) {
      return { ok: false, saved: false, message: "Which key?" };
    }
    try {
      await removeProviderKeyById(maker, parsed.data.keyId);
    } catch (error) {
      return refused(error);
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

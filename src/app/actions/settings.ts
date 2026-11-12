"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  modelLabel,
  PROVIDER_LABELS,
  ProviderId,
} from "@/domain/model-defaults";
import { AgentRoutes, MakerRoutes } from "@/domain/model-routing";
import { providerMode } from "@/providers/mode";
import { agentRoutesProblem } from "@/server/chat/agent-route";
import { saveMakerRoutes, setSceneLook } from "@/server/maker-repository";
import { checkKey } from "@/server/provider-health";
import { removeProviderKey, saveProviderKey } from "@/server/provider-keys";

const SavedRoutes = z.object({ routes: MakerRoutes, agents: AgentRoutes });

// Settings → Models: a route per role and the agents' own. Zod is the trust
// boundary: every model one Kiln offers for the route's kind, with a pinned
// price, once per route; an agent Kiln has, on models that read images when
// it looks at them.
export async function saveMakerRoutesAction(
  input: unknown,
): Promise<{ error?: string }> {
  const parsed = SavedRoutes.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Pick a model for each role.",
    };
  }
  const problem = agentRoutesProblem(parsed.data.agents);
  if (problem) return { error: problem };
  try {
    await saveMakerRoutes(parsed.data.routes, parsed.data.agents);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  refresh();
  return {};
}

// Settings → Providers: a key checked for free, the answer kept as the
// provider's latest call.
export async function checkProviderKeyAction(
  input: unknown,
): Promise<{ ok: boolean; message: string }> {
  const parsed = ProviderId.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Which provider?" };
  const result = await checkKey(parsed.data);
  if (result.called) refresh();
  if (!result.ok) return { ok: false, message: result.message };
  const label = PROVIDER_LABELS[parsed.data];
  const gone = (result.unlisted ?? []).map((model) =>
    modelLabel({ provider: parsed.data, model }),
  );
  return {
    ok: true,
    message: gone.length
      ? `${label} accepts the key, but no longer lists ${gone.join(", ")}: Kiln will not run ${gone.length === 1 ? "it" : "them"}.`
      : `${label} accepts the key.`,
  };
}

const SavedKey = z.object({
  provider: ProviderId,
  key: z.string().min(1).max(400),
});

// Settings → Providers: keep a provider's key (sealed, never sent back), then
// check it for free, so the answer the maker reads is the provider's own.
export async function saveProviderKeyAction(
  input: unknown,
): Promise<{ ok: boolean; message: string }> {
  const parsed = SavedKey.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Paste the key first." };
  if (providerMode() === "mock") {
    return {
      ok: false,
      message: "Mock mode calls no provider: add keys in a live run.",
    };
  }
  try {
    await saveProviderKey(parsed.data.provider, parsed.data.key);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const checked = await checkProviderKeyAction(parsed.data.provider);
  refresh();
  return checked.ok
    ? { ok: true, message: `Saved. ${checked.message}` }
    : { ok: false, message: `Saved, but: ${checked.message}` };
}

export async function removeProviderKeyAction(
  input: unknown,
): Promise<{ ok: boolean; message: string }> {
  const parsed = ProviderId.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Which provider?" };
  try {
    await removeProviderKey(parsed.data);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  refresh();
  return { ok: true, message: "Removed." };
}

// Settings → Checks: the paid look at every scene, on or off.
export async function setSceneLookAction(
  input: unknown,
): Promise<{ error?: string }> {
  const parsed = z.boolean().safeParse(input);
  if (!parsed.success) return { error: "On or off?" };
  try {
    await setSceneLook(parsed.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  refresh();
  return {};
}

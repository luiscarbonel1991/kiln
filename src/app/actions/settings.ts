"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  modelLabel,
  PROVIDER_LABELS,
  ProviderId,
} from "@/domain/model-defaults";
import { AgentRoutes, MakerRoutes } from "@/domain/model-routing";
import { agentRoutesProblem } from "@/server/chat/agent-route";
import { saveMakerRoutes } from "@/server/maker-repository";
import { checkKey } from "@/server/provider-health";

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

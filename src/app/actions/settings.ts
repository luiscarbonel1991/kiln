"use server";

import { refresh } from "next/cache";
import { PROVIDER_LABELS, ProviderId } from "@/domain/model-defaults";
import { MakerRoutes } from "@/domain/model-routing";
import { saveMakerRoutes } from "@/server/maker-repository";
import { checkKey } from "@/server/provider-health";

// Settings → Models: a route per role. Zod is the trust boundary: every model
// one Kiln offers for the role, with a pinned price, once per route.
export async function saveMakerRoutesAction(
  input: unknown,
): Promise<{ error?: string }> {
  const parsed = MakerRoutes.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Pick a model for each role.",
    };
  }
  try {
    await saveMakerRoutes(parsed.data);
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
  return result.ok
    ? { ok: true, message: `${PROVIDER_LABELS[parsed.data]} accepts the key.` }
    : { ok: false, message: result.message };
}

"use server";

import { refresh } from "next/cache";
import {
  MakerModels,
  PROVIDER_LABELS,
  ProviderId,
} from "@/domain/model-defaults";
import { saveMakerModels } from "@/server/maker-repository";
import { checkKey } from "@/server/provider-health";

// Settings → Models: the maker's default model per kind. Zod is the trust
// boundary; the repository refuses a model Kiln does not offer or has no
// pinned price for.
export async function saveMakerModelsAction(
  input: unknown,
): Promise<{ error?: string }> {
  const parsed = MakerModels.safeParse(input);
  if (!parsed.success) return { error: "Pick a model for each kind." };
  try {
    await saveMakerModels(parsed.data);
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

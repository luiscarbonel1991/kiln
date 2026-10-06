"use server";

import { refresh } from "next/cache";
import { MakerModels } from "@/domain/model-defaults";
import { saveMakerModels } from "@/server/maker-repository";

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

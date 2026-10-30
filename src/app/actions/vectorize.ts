"use server";

import { z } from "zod";
import { setCardVector } from "@/server/project-repository";
import { traceToVector, VectorDetail, VectorMode } from "@/server/vectorize";

const VectorizeInput = z.object({
  imageUrl: z.string().url(),
  mode: VectorMode.default("outline"),
  detail: VectorDetail.default("balanced"),
  // A saved project's card: the vector is stored on it here, for the take
  // traced, so a poll of the server never takes it back from the editor.
  projectId: z.string().min(1).optional(),
  cardId: z.string().min(1).optional(),
});

// Server Function: trace a raster (a generated line-art image) into a REAL SVG
// (server/vectorize.ts). Only meaningful for high-contrast line art, so the UI
// only exposes this for line-art cards. A failure comes back with its reason,
// never silently.
export async function vectorizeCardAction(
  input: unknown,
): Promise<{ url: string } | { error: string }> {
  const { imageUrl, mode, detail, projectId, cardId } =
    VectorizeInput.parse(input);
  const traced = await traceToVector(imageUrl, mode, detail);
  if ("error" in traced) return traced;
  if (projectId && cardId) {
    await setCardVector(projectId, cardId, imageUrl, traced.url);
  }
  return { url: traced.url };
}

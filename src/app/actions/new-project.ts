"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { chosenLook } from "@/domain/plan-look";
import { Look, resolveLook } from "@/domain/product-look";
import { lookDesign } from "@/server/product-reference";
import { getProduct } from "@/server/product-repository";
import { requireMaker } from "@/server/session";
import { startProject } from "@/server/start-project";

// Start a project from New project (src/server/start-project.ts): no model is
// called. On success it redirects to the board; on a refusal it returns the
// reason.
export async function createProjectAction(
  input: unknown,
): Promise<{ error: string }> {
  await requireMaker();
  const started = await startProject(input);
  if ("error" in started) return started;
  redirect(`/projects/${started.id}`);
}

const LookAsk = z.object({ productId: z.string().min(1), look: Look });

// The design a look draws, for New project's preview of its exact frames:
// free, stored by its bytes. Nothing changes on the product.
export async function lookDesignAction(
  input: unknown,
): Promise<{ design: string } | { error: string }> {
  await requireMaker();
  const parsed = LookAsk.safeParse(input);
  if (!parsed.success) return { error: "Pick a colour or a style." };
  const product = await getProduct(parsed.data.productId);
  if (!product) return { error: "That product no longer exists." };
  const chosen = chosenLook(product, parsed.data.look);
  if ("refused" in chosen) return { error: chosen.refused };
  const drawn = await lookDesign(product, resolveLook(product, chosen.look));
  return "refused" in drawn ? { error: drawn.refused } : drawn;
}

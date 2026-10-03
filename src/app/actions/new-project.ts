"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { planProject } from "@/domain/plan";
import { ProjectType } from "@/domain/project";
import { startEditorState } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { productReference } from "@/server/product-reference";
import { getProduct } from "@/server/product-repository";
import { createProject } from "@/server/project-repository";

// Only ids cross the boundary: the plan is rebuilt here from the catalog, never
// accepted from the client. Design projects start in the studio instead.
const Input = z.object({
  productId: z.string().min(1),
  type: ProjectType.exclude(["design"]),
  destinationIds: z.array(z.string().min(1)).min(1).max(12),
});

// Start a project: plan, the product's reference (if Kiln can make one for
// free), draft cards for the scene slots. No model is called. On success it
// redirects to the board; on a refusal it returns the reason.
export async function createProjectAction(
  input: unknown,
): Promise<{ error: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    return { error: "Pick a product, a type and a destination." };
  const { productId, type, destinationIds } = parsed.data;
  const product = await getProduct(productId);
  if (!product) return { error: "That product no longer exists." };
  let id: string;
  try {
    const plan = planProject({
      product,
      type,
      destinationIds,
      catalog: CATALOG,
    });
    const master = await productReference(product);
    const editor = startEditorState({ product, type, plan, master });
    id = await createProject({ type, productId: product.id, plan, editor });
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not start the project.",
    };
  }
  redirect(`/projects/${id}`);
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ListingUrl, LivePhoto, MAX_LIVE_PHOTOS } from "@/domain/live-listing";
import {
  parseSlotCardId,
  planFromListing,
  planProject,
  withSlotOff,
} from "@/domain/plan";
import { ProjectType } from "@/domain/project";
import { startEditorState } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { isAllowedAssetUrl } from "@/providers/asset-bytes";
import { getMakerModels } from "@/server/maker-repository";
import { productReference } from "@/server/product-reference";
import { getProduct } from "@/server/product-repository";
import { createProject } from "@/server/project-repository";

// Only ids cross the boundary: the plan is rebuilt here from the catalog, never
// accepted from the client; `offSlots` are slot card ids ("etsy.gift") the
// maker switched off, each checked against the rebuilt plan. Design projects
// start in the studio instead. `live` starts a Listing kit from a live
// listing: its address and its photos (already in Kiln's storage), each kept
// or replaced by a frame; the plan is rebuilt from them too.
const Input = z.object({
  productId: z.string().min(1),
  type: ProjectType.exclude(["design"]),
  destinationIds: z.array(z.string().min(1)).min(1).max(12),
  offSlots: z.array(z.string().min(1)).max(60).default([]),
  live: z
    .object({
      listingUrl: ListingUrl.optional(),
      photos: z.array(LivePhoto).min(1).max(MAX_LIVE_PHOTOS),
    })
    .optional(),
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
  const { productId, type, destinationIds, offSlots, live } = parsed.data;
  if (live && (type !== "listing-kit" || destinationIds.length !== 1)) {
    return { error: "A live listing refreshes one sale destination." };
  }
  if (
    live?.photos.some(
      (p) => p.url.startsWith("data:") || !isAllowedAssetUrl(p.url),
    )
  ) {
    return { error: "Add the listing's photos here first, then start." };
  }
  const product = await getProduct(productId);
  if (!product) return { error: "That product no longer exists." };
  let id: string;
  try {
    const plan = offSlots.reduce(
      (p, id) => {
        const ref = parseSlotCardId(id);
        if (!ref) throw new Error(`"${id}" is not a slot of this plan.`);
        return withSlotOff(p, ref, true);
      },
      live
        ? planFromListing({
            product,
            destinationId: destinationIds[0],
            catalog: CATALOG,
            listingUrl: live.listingUrl,
            photos: live.photos,
          })
        : planProject({ product, type, destinationIds, catalog: CATALOG }),
    );
    const master = await productReference(product);
    const editor = startEditorState({
      product,
      type,
      plan,
      master,
      models: await getMakerModels(),
    });
    id = await createProject({ type, product, plan, editor });
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not start the project.",
    };
  }
  redirect(`/projects/${id}`);
}

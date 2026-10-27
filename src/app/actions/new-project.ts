"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  HeroSetting,
  heroProposal,
  heroSettingsOf,
  withHeroSettings,
} from "@/domain/hero-setting";
import { ListingUrl, LivePhoto, MAX_LIVE_PHOTOS } from "@/domain/live-listing";
import {
  parseSlotCardId,
  planFromListing,
  planProject,
  withBrief,
  withSlotOff,
  withThreeQuarter,
} from "@/domain/plan";
import { ProjectType } from "@/domain/project";
import { startEditorState } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { isAllowedAssetUrl } from "@/providers/asset-bytes";
import {
  getMakerModels,
  getMakerPreferences,
  rememberHeroSetting,
} from "@/server/maker-repository";
import {
  productReference,
  threeQuarterReference,
} from "@/server/product-reference";
import { getProduct } from "@/server/product-repository";
import { createProject, latestBriefs } from "@/server/project-repository";

// Only ids cross the boundary: the plan is rebuilt here from the catalog, never
// accepted from the client; `offSlots` are slot card ids ("etsy.gift") the
// maker switched off, each checked against the rebuilt plan. Design projects
// start in the studio instead. `live` starts a Listing kit from a live
// listing: its address and its photos (already in Kiln's storage), each kept
// or replaced by a frame; the plan is rebuilt from them too. `heroSettings`
// is each destination's hero setting as the plan step showed it; one left out
// takes Kiln's proposal.
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
  heroSettings: z.record(z.string().min(1), HeroSetting).default({}),
});

// Start a project: plan (with the product's last market brief per
// destination), the product's reference (if Kiln can make one for free),
// draft cards for the scene slots. No model is called. On success it
// redirects to the board; on a refusal it returns the reason.
export async function createProjectAction(
  input: unknown,
): Promise<{ error: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    return { error: "Pick a product, a type and a destination." };
  const { productId, type, destinationIds, offSlots, live, heroSettings } =
    parsed.data;
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
    const planned = offSlots.reduce(
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
    const { heroSetting: remembered } = await getMakerPreferences();
    const proposed = (id: string) =>
      heroProposal(product, id, remembered).setting;
    // Each destination starts from the product's last market brief there,
    // named where it came from.
    const carried = await latestBriefs(product.id);
    const shaped = Object.entries(carried).reduce(
      (p, [destinationId, { brief, projectName }]) =>
        p.destinations.some((d) => d.destinationId === destinationId)
          ? withBrief(p, destinationId, {
              ...brief,
              carriedFrom: projectName.slice(0, 120),
            })
          : p,
      withHeroSettings(planned, (id) => heroSettings[id] ?? proposed(id)),
    );
    // A product with a part lying flat also gets its view from above.
    const master = await productReference(product);
    const plan = withThreeQuarter(
      shaped,
      await threeQuarterReference(product, master),
    );
    const editor = startEditorState({
      product,
      type,
      plan,
      master,
      models: await getMakerModels(),
    });
    id = await createProject({ type, product, plan, editor });
    // A hero the maker set apart from the proposal is proposed so next time
    // for this family on that destination; an accepted guess stays a guess.
    for (const { destinationId, setting } of heroSettingsOf(plan)) {
      if (setting !== proposed(destinationId)) {
        await rememberHeroSetting(destinationId, product.family, setting);
      }
    }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not start the project.",
    };
  }
  redirect(`/projects/${id}`);
}

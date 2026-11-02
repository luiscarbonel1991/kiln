import { z } from "zod";
import {
  HeroSetting,
  heroProposal,
  heroSettingsOf,
  withHeroSettings,
} from "@/domain/hero-setting";
import { withLearned } from "@/domain/lesson";
import { ListingUrl, LivePhoto, MAX_LIVE_PHOTOS } from "@/domain/live-listing";
import {
  type ProjectPlan,
  parseSlotCardId,
  planFromListing,
  planProject,
  withBrief,
  withSlotOff,
  withThreeQuarter,
} from "@/domain/plan";
import { chosenLook, projectLook, withLookReference } from "@/domain/plan-look";
import type { Product } from "@/domain/product";
import { Look } from "@/domain/product-look";
import { ProjectType } from "@/domain/project";
import { startEditorState } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { isAllowedAssetUrl } from "@/providers/asset-bytes";
import { keptMoves } from "@/server/lessons";
import {
  getMakerModels,
  getMakerPreferences,
  rememberHeroSetting,
} from "@/server/maker-repository";
import { lookedReference } from "@/server/product-reference";
import { getProduct } from "@/server/product-repository";
import { createProject, latestBriefs } from "@/server/project-repository";

// Starting a project, from New project (its action) or the create_project
// tool. Only ids cross the boundary: the plan is rebuilt here from the
// catalog, never accepted from the caller; `offSlots` are slot card ids
// ("etsy.gift") the maker switched off, each checked against the rebuilt
// plan. Design projects start in the studio instead. `live` starts a Listing
// kit from a live listing: its address and its photos (already in Kiln's
// storage), each kept or replaced by a frame; the plan is rebuilt from them
// too. `heroSettings` is each destination's hero setting as the plan step
// showed it; one left out takes Kiln's proposal. `look` is the colour and
// style the project shows; left out, the product's default (which never
// changes for it).
export const StartProject = z.object({
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
  look: Look.optional(),
});
export type StartProject = z.output<typeof StartProject>;

// The plan a project would start with, and Kiln's hero proposal per
// destination: the catalog's slots, those switched off, each hero's setting,
// and the product's last market brief per destination. Nothing is saved.
export async function startingPlan(
  product: Product,
  input: Omit<StartProject, "productId">,
): Promise<{ plan: ProjectPlan; proposed: (id: string) => HeroSetting }> {
  const { type, destinationIds, offSlots, live, heroSettings } = input;
  const chosen = chosenLook(product, input.look);
  if ("refused" in chosen) throw new Error(chosen.refused);
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
  // The frames start with the knobs the maker's kept lessons set for the
  // family.
  const looked = chosen.look ? { ...planned, look: chosen.look } : planned;
  const learned = withLearned(looked, await keptMoves(product.family));
  const { heroSetting: remembered } = await getMakerPreferences();
  const proposed = (id: string) =>
    heroProposal(product, id, remembered).setting;
  // Each destination starts from the product's last market brief there,
  // named where it came from.
  const carried = await latestBriefs(product.id);
  const plan = Object.entries(carried).reduce(
    (p, [destinationId, { brief, projectName }]) =>
      p.destinations.some((d) => d.destinationId === destinationId)
        ? withBrief(p, destinationId, {
            ...brief,
            carriedFrom: projectName.slice(0, 120),
          })
        : p,
    withHeroSettings(learned, (id) => heroSettings[id] ?? proposed(id)),
  );
  return { plan, proposed };
}

// Start a project: plan (with the product's last market brief per
// destination), the product's reference in the project's look (if Kiln can
// make one for free), draft cards for the scene slots. No model is called. Answers the new
// project's id, or the reason it was refused.
export async function startProject(
  input: unknown,
): Promise<{ id: string } | { error: string }> {
  const parsed = StartProject.safeParse(input);
  if (!parsed.success)
    return { error: "Pick a product, a type and a destination." };
  const { productId, type, destinationIds, live } = parsed.data;
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
  try {
    const { plan: shaped, proposed } = await startingPlan(product, parsed.data);
    // The reference in the project's look; a product with a part lying flat
    // also gets its view from above.
    const { master, drawn, refused } = await lookedReference(
      product,
      projectLook(shaped, product),
    );
    if (refused && shaped.look) return { error: refused };
    const viewed = withThreeQuarter(shaped, drawn?.threeQuarter ?? null);
    const plan = drawn ? withLookReference(viewed, drawn) : viewed;
    const editor = startEditorState({
      product,
      type,
      plan,
      master,
      models: await getMakerModels(),
    });
    const id = await createProject({ type, product, plan, editor });
    // A hero the maker set apart from the proposal is proposed so next time
    // for this family on that destination; an accepted guess stays a guess.
    for (const { destinationId, setting } of heroSettingsOf(plan)) {
      if (setting !== proposed(destinationId)) {
        await rememberHeroSetting(destinationId, product.family, setting);
      }
    }
    return { id };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not start the project.",
    };
  }
}

import { z } from "zod";
import type { DestinationProfile } from "@/domain/destination";
import { RenderStyle, type ShotList, sceneSlots } from "@/domain/shot-list";

// A listing slot: a buyer-decision job, not a photo style. `label` is the short
// card title; `purpose` is its commercial goal — it drives the ArtDirector and is
// shown to the user. `aspect` optionally overrides the recipe target for this slot
// (e.g. a 1:1 hero inside a 4:5 recipe).
export const ListingSlot = z.object({
  label: z.string(),
  purpose: z.string(),
  aspect: z.string().optional(),
});
export type ListingSlot = z.infer<typeof ListingSlot>;

const Target = z.object({ name: z.string(), aspect: z.string() });
type Target = z.infer<typeof Target>;

// The resolved view the studio editor consumes (cascade, buildCards, the art
// directors). It is composed from a shot list + a destination profile — see
// composeRecipe — and never authored directly.
export const Recipe = z.object({
  id: z.string(),
  name: z.string(),
  // assemblePrompt branches on the style (photographic vs line-art).
  style: RenderStyle.default("photographic"),
  directions: z.array(ListingSlot),
  fieldDefaults: z.record(z.string(), z.string()),
  targets: z.array(Target),
  constraints: z.object({
    preserve: z.array(z.string()).default([]),
    negative: z.array(z.string()).default([]),
  }),
});
export type Recipe = z.infer<typeof Recipe>;

// A named editor preset (the Planning recipe chips): a shot list on at most one
// destination. Its id is the recipe id saved on cards and projects, so it stays
// stable. `targets` is display-only (the chip text).
export const RecipePreset = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shotListId: z.string().min(1),
  destinationId: z.string().min(1).nullable(),
  targets: z.array(Target).min(1),
});
export type RecipePreset = z.infer<typeof RecipePreset>;

const dedupe = (items: string[]) => [...new Set(items)];

function defaultTargets(
  list: ShotList,
  destination: DestinationProfile | null,
): Target[] {
  if (destination) {
    return destination.formats.map((f) => ({
      name: destination.name,
      aspect: f.aspect,
    }));
  }
  const aspects = dedupe(
    list.slots.map((s) => s.aspect).filter((a): a is string => !!a),
  );
  return aspects.map((aspect) => ({ name: list.name, aspect }));
}

// Shot list + destination -> the editor's Recipe. Only scene slots become
// directions (exact slots are rendered from the spec, never by the editor); the
// negatives are the destination's then the shot list's, deduplicated.
export function composeRecipe(input: {
  id: string;
  name: string;
  shotList: ShotList;
  destination: DestinationProfile | null;
  targets?: Target[];
}): Recipe {
  const { shotList, destination } = input;
  if ((destination?.id ?? null) !== shotList.destinationId) {
    throw new Error(
      `shot list "${shotList.id}" targets "${shotList.destinationId}", got "${destination?.id ?? null}"`,
    );
  }
  return Recipe.parse({
    id: input.id,
    name: input.name,
    style: shotList.style,
    directions: sceneSlots(shotList).map(({ label, purpose, aspect }) =>
      aspect ? { label, purpose, aspect } : { label, purpose },
    ),
    fieldDefaults: shotList.fieldDefaults,
    targets: input.targets ?? defaultTargets(shotList, destination),
    constraints: {
      preserve: shotList.preserve,
      negative: dedupe([
        ...(destination?.rules.negative ?? []),
        ...shotList.negative,
      ]),
    },
  });
}

// Resolves a preset against a catalog of shot lists and destinations. Unknown
// ids throw: seeds are composed at module load, so a broken seed fails fast.
export function composePreset(
  preset: RecipePreset,
  catalog: { shotLists: ShotList[]; destinations: DestinationProfile[] },
): Recipe {
  const shotList = catalog.shotLists.find((l) => l.id === preset.shotListId);
  if (!shotList) throw new Error(`unknown shot list "${preset.shotListId}"`);
  const destination =
    preset.destinationId === null
      ? null
      : catalog.destinations.find((d) => d.id === preset.destinationId);
  if (destination === undefined) {
    throw new Error(`unknown destination "${preset.destinationId}"`);
  }
  return composeRecipe({
    id: preset.id,
    name: preset.name,
    shotList,
    destination,
    targets: preset.targets,
  });
}

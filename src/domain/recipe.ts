import { z } from "zod";

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

export const Recipe = z.object({
  id: z.string(),
  name: z.string(),
  // Render style drives the prompt framing: "photographic" (the default — a
  // product photo) vs "line-art" (clean black strokes on white, for laser /
  // vector workflows). assemblePrompt branches on this.
  style: z.enum(["photographic", "line-art"]).default("photographic"),
  directions: z.array(ListingSlot),
  fieldDefaults: z.record(z.string(), z.string()),
  targets: z.array(z.object({ name: z.string(), aspect: z.string() })),
  constraints: z.object({
    preserve: z.array(z.string()).default([]),
    negative: z.array(z.string()).default([]),
  }),
});
export type Recipe = z.infer<typeof Recipe>;

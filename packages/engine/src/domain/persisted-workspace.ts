import { z } from "zod";
import { Card } from "@/domain/card";
import { PlanningFields } from "@/domain/cascade";
import { MasterAsset } from "@/domain/master-asset";
import { BaseUnderstanding } from "@/domain/understanding";

// The save/load unit: the store's persistable slice as domain types (no
// renderSeed — that is UI state, reconstructed on hydrate). Validated at the
// Server Action boundary on save and again after rowsToWorkspace on load.
export const PersistedWorkspace = z.object({
  name: z.string().min(1),
  phase: z.enum(["upload", "analysis", "planning", "generation"]),
  master: MasterAsset.nullable(),
  understanding: BaseUnderstanding.nullable(),
  recipeId: z.string().nullable(),
  planning: PlanningFields.nullable(),
  cards: z.array(Card),
});
export type PersistedWorkspace = z.infer<typeof PersistedWorkspace>;

// A saved workspace plus its db id (the load result + resume target).
export const PersistedWorkspaceRecord = PersistedWorkspace.extend({
  id: z.string(),
});
export type PersistedWorkspaceRecord = z.infer<typeof PersistedWorkspaceRecord>;

// The four studio phases — also the persisted `phase` enum values.
export type Phase = z.infer<typeof PersistedWorkspace>["phase"];

// Read-only list projection for the workspace gallery: just enough to render a
// card (thumbnail, name, phase, date, count) without loading the full record.
// Not a Zod schema — it is an outbound DB read, not a client-trusted input.
export type WorkspaceSummary = {
  id: string;
  name: string;
  phase: Phase;
  updatedAt: Date;
  thumbnailUrl: string | null;
  sourcePrompt: string | null;
  cardCount: number;
};

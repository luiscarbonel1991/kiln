import { z } from "zod";
import { Card } from "@/domain/card";
import { PlanningFields } from "@/domain/cascade";
import { MasterAsset } from "@/domain/master-asset";
import type { ProjectType } from "@/domain/project";
import { BaseUnderstanding } from "@/domain/understanding";

// The studio editor's save/load unit: the store's persistable slice as domain
// types (no renderSeed — that is UI state, reconstructed on hydrate). Validated
// at the Server Action boundary on save and again after rowsToProject on load.
// The project's maker, type and products are owned by the server, not the editor.
export const PersistedProject = z.object({
  name: z.string().min(1),
  phase: z.enum(["upload", "analysis", "planning", "generation"]),
  master: MasterAsset.nullable(),
  understanding: BaseUnderstanding.nullable(),
  recipeId: z.string().nullable(),
  planning: PlanningFields.nullable(),
  cards: z.array(Card),
});
export type PersistedProject = z.infer<typeof PersistedProject>;

// A saved project plus its db id (the load result + resume target).
export const PersistedProjectRecord = PersistedProject.extend({
  id: z.string(),
});
export type PersistedProjectRecord = z.infer<typeof PersistedProjectRecord>;

// The four studio phases — also the persisted `phase` enum values.
export type Phase = z.infer<typeof PersistedProject>["phase"];

// Read-only list projection for the project gallery: just enough to render a
// card (thumbnail, name, type, phase, date, count) without loading the record.
// Not a Zod schema — it is an outbound DB read, not a client-trusted input.
export type ProjectSummary = {
  id: string;
  name: string;
  type: ProjectType;
  // Started from the New project flow (has a plan): opens on the board.
  planned: boolean;
  phase: Phase;
  updatedAt: Date;
  thumbnailUrl: string | null;
  sourcePrompt: string | null;
  cardCount: number;
};

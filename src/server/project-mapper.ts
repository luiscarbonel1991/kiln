import { Card } from "@/domain/card";
import { PlanningFields } from "@/domain/cascade";
import { MasterAsset } from "@/domain/master-asset";
import {
  type PersistedProject,
  PersistedProjectRecord,
  type Phase,
  type ProjectSummary,
} from "@/domain/persisted-project";
import { ProjectPlan } from "@/domain/plan";
import { ProjectType } from "@/domain/project";
import { BaseUnderstanding } from "@/domain/understanding";

// Plain row shapes — structurally compatible with the Prisma models, but defined
// here so the mapper stays Prisma-free and unit-testable without a generated
// client. The repository feeds Prisma rows in/out of these. Lineage rides on the
// domain `parentCardId` (no surrogate pk); JSON blobs are typed `unknown` and
// re-validated through their domain Zod schemas on the way back.

export interface MasterAssetRow {
  assetId: string;
  origin: string;
  sourcePrompt: string | null;
  assetUrl: string;
  mime: string;
}

export interface CardRow {
  cardId: string;
  parentCardId: string | null;
  masterAssetId: string;
  recipeId: string;
  type: string;
  direction: string;
  fields: unknown;
  references: unknown;
  model: unknown;
  video: unknown;
  promptOverride: string | null;
  vectorUrl: string | null;
  outputs: unknown;
  status: string;
  sortOrder: number;
}

export interface ProjectRows {
  name: string;
  phase: string;
  recipeId: string | null;
  understanding: unknown;
  planning: unknown;
  master: MasterAssetRow | null;
  cards: CardRow[];
}

export interface ProjectRecord extends ProjectRows {
  id: string;
}

// Row shape for the gallery list projection (Prisma-free, so it stays unit-
// testable). The repository feeds it Prisma `findMany` rows with a master
// thumbnail + a card `_count`.
export interface ProjectSummaryRow {
  id: string;
  name: string;
  type: string;
  plan: unknown;
  phase: string;
  updatedAt: Date;
  master: { assetUrl: string; sourcePrompt: string | null } | null;
  _count: { cards: number };
}

// The project type of a studio-driven project follows its recipe. The SQL CASE
// in prisma/migrations/20261002230000_maker_project_product mirrors this for the
// workspaces that existed before projects.
export function studioProjectType(recipeId: string | null): ProjectType {
  if (recipeId === "recipe-laser-lineart") return "design";
  if (recipeId === "recipe-social-launch" || recipeId === "recipe-ads") {
    return "content";
  }
  return "listing-kit";
}

// The columns the editor's autosave writes. `name` is set once at create and
// changed only by rename; `makerId`, the products, the plan and the type of a
// planned project are server-owned. None is here, so an autosave can never
// overwrite them. (A studio project's type follows its recipe: the repository
// re-derives it only where there is no plan.)
export function projectUpdateData(rows: ProjectRows) {
  return {
    phase: rows.phase,
    recipeId: rows.recipeId,
    understanding: rows.understanding,
    planning: rows.planning,
  };
}

export function projectCreateData(rows: ProjectRows) {
  return {
    name: rows.name,
    type: studioProjectType(rows.recipeId),
    ...projectUpdateData(rows),
  };
}

// Narrow the DB's free `String` columns to their unions; unknown/legacy values
// fall back so the gallery never renders a broken badge.
const PHASES = ["upload", "analysis", "planning", "generation"] as const;
function toPhase(value: string): Phase {
  return (PHASES as readonly string[]).includes(value)
    ? (value as Phase)
    : "upload";
}

function toProjectType(value: string): ProjectType {
  const parsed = ProjectType.safeParse(value);
  return parsed.success ? parsed.data : "listing-kit";
}

// A list row -> ProjectSummary: flattens the master thumbnail + card count and
// narrows phase and type. Pure (no Prisma, no db) — see project-mapper.test.ts.
export function toProjectSummary(row: ProjectSummaryRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    type: toProjectType(row.type),
    planned: row.plan !== null,
    phase: toPhase(row.phase),
    updatedAt: row.updatedAt,
    thumbnailUrl: row.master?.assetUrl ?? null,
    sourcePrompt: row.master?.sourcePrompt ?? null,
    cardCount: row._count.cards,
  };
}

// PersistedProject -> row shapes for the repository to persist. sortOrder is the
// array index (restored order); video is normalized to null for the DB column.
export function projectToRows(state: PersistedProject): ProjectRows {
  return {
    name: state.name,
    phase: state.phase,
    recipeId: state.recipeId,
    understanding: state.understanding,
    planning: state.planning,
    master: state.master
      ? {
          assetId: state.master.id,
          origin: state.master.origin,
          sourcePrompt: state.master.sourcePrompt,
          assetUrl: state.master.assetUrl,
          mime: state.master.mime,
        }
      : null,
    cards: state.cards.map((card, index) => ({
      cardId: card.id,
      parentCardId: card.parentId,
      masterAssetId: card.masterAssetId,
      recipeId: card.recipeId,
      type: card.type,
      direction: card.direction,
      fields: card.fields,
      references: card.references,
      model: card.model,
      video: card.video ?? null,
      promptOverride: card.promptOverride ?? null,
      vectorUrl: card.vectorUrl ?? null,
      outputs: card.outputs,
      status: card.status,
      sortOrder: index,
    })),
  };
}

// Rows -> a validated PersistedProjectRecord. Cards are re-sorted by sortOrder
// and `parentId` comes straight from `parentCardId`. Every JSON blob is re-parsed
// through its domain schema (never trust the DB column type). renderSeed is NOT
// here — the store rebuilds it on hydrate.
export function rowsToProject(record: ProjectRecord): PersistedProjectRecord {
  const cards = [...record.cards]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((row) => {
      // Tolerant per-card decode: a card persisted before a schema change (e.g.
      // an old card missing the materials/mood fields) is skipped, not fatal —
      // the rest of the project still restores. flatMap([]/[data]) = filter+map.
      const parsed = Card.safeParse({
        id: row.cardId,
        parentId: row.parentCardId,
        masterAssetId: row.masterAssetId,
        recipeId: row.recipeId,
        type: row.type,
        direction: row.direction,
        fields: row.fields,
        references: row.references,
        model: row.model,
        video: row.video ?? undefined,
        promptOverride: row.promptOverride ?? undefined,
        vectorUrl: row.vectorUrl ?? undefined,
        outputs: row.outputs,
        status: row.status,
      });
      return parsed.success ? [parsed.data] : [];
    });

  const master = record.master
    ? MasterAsset.parse({
        id: record.master.assetId,
        origin: record.master.origin,
        sourcePrompt: record.master.sourcePrompt,
        assetUrl: record.master.assetUrl,
        mime: record.master.mime,
      })
    : null;

  return PersistedProjectRecord.parse({
    id: record.id,
    name: record.name,
    phase: record.phase,
    master,
    understanding:
      record.understanding === null
        ? null
        : BaseUnderstanding.parse(record.understanding),
    recipeId: record.recipeId,
    planning:
      record.planning === null ? null : PlanningFields.parse(record.planning),
    cards,
  });
}

// The board's read model: the project, its plan and product, the anchor image
// and the editor's cards (the scene slots' candidates).
export interface ProjectBoard {
  id: string;
  name: string;
  type: ProjectType;
  plan: ProjectPlan | null;
  master: MasterAsset | null;
  cards: Card[];
}

export interface ProjectBoardRecord {
  id: string;
  name: string;
  type: string;
  plan: unknown;
  master: MasterAssetRow | null;
  cards: CardRow[];
}

// A plan that no longer parses reads as null (the board then offers the editor
// only), like the tolerant card decode.
export function rowsToBoard(record: ProjectBoardRecord): ProjectBoard {
  const plan = ProjectPlan.safeParse(record.plan);
  const restored = rowsToProject({
    id: record.id,
    name: record.name,
    phase: "generation",
    recipeId: null,
    understanding: null,
    planning: null,
    master: record.master,
    cards: record.cards,
  });
  return {
    id: record.id,
    name: record.name,
    type: toProjectType(record.type),
    plan: record.plan !== null && plan.success ? plan.data : null,
    master: restored.master,
    cards: restored.cards,
  };
}

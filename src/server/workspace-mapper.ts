import { Card } from "@/domain/card";
import { PlanningFields } from "@/domain/cascade";
import { MasterAsset } from "@/domain/master-asset";
import {
  type PersistedWorkspace,
  PersistedWorkspaceRecord,
  type Phase,
  type WorkspaceSummary,
} from "@/domain/persisted-workspace";
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

export interface WorkspaceRows {
  name: string;
  phase: string;
  recipeId: string | null;
  understanding: unknown;
  planning: unknown;
  master: MasterAssetRow | null;
  cards: CardRow[];
}

export interface WorkspaceRecord extends WorkspaceRows {
  id: string;
}

// Row shape for the gallery list projection (Prisma-free, so it stays unit-
// testable). The repository feeds it Prisma `findMany` rows with a master
// thumbnail + a card `_count`.
export interface WorkspaceSummaryRow {
  id: string;
  name: string;
  phase: string;
  updatedAt: Date;
  master: { assetUrl: string; sourcePrompt: string | null } | null;
  _count: { cards: number };
}

// Narrow the DB's free `String` phase column to the Phase union; unknown/legacy
// values fall back to "upload" so the gallery never renders a broken badge.
const PHASES = ["upload", "analysis", "planning", "generation"] as const;
function toPhase(value: string): Phase {
  return (PHASES as readonly string[]).includes(value)
    ? (value as Phase)
    : "upload";
}

// A list row -> WorkspaceSummary: flattens the master thumbnail + card count and
// narrows the phase. Pure (no Prisma, no db) — see workspace-mapper.test.ts.
export function toWorkspaceSummary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    phase: toPhase(row.phase),
    updatedAt: row.updatedAt,
    thumbnailUrl: row.master?.assetUrl ?? null,
    sourcePrompt: row.master?.sourcePrompt ?? null,
    cardCount: row._count.cards,
  };
}

// PersistedWorkspace -> row shapes for the repository to persist. sortOrder is the
// array index (restored order); video is normalized to null for the DB column.
export function workspaceToRows(state: PersistedWorkspace): WorkspaceRows {
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

// Rows -> a validated PersistedWorkspaceRecord. Cards are re-sorted by sortOrder
// and `parentId` comes straight from `parentCardId`. Every JSON blob is re-parsed
// through its domain schema (never trust the DB column type). renderSeed is NOT
// here — the store rebuilds it on hydrate.
export function rowsToWorkspace(
  record: WorkspaceRecord,
): PersistedWorkspaceRecord {
  const cards = [...record.cards]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((row) => {
      // Tolerant per-card decode: a card persisted before a schema change (e.g.
      // an old card missing the materials/mood fields) is skipped, not fatal —
      // the rest of the workspace still restores. flatMap([]/[data]) = filter+map.
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

  return PersistedWorkspaceRecord.parse({
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

import { Prisma } from "@prisma/client";
import type {
  PersistedWorkspace,
  PersistedWorkspaceRecord,
  WorkspaceSummary,
} from "@/domain/persisted-workspace";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  rowsToWorkspace,
  toWorkspaceSummary,
  type WorkspaceRecord,
  workspaceToRows,
} from "@/server/workspace-mapper";

// DATABASE_URL is optional in env.ts (so DB-free build/test never throw). The
// repository is the runtime assertion point, with an actionable message.
function assertDatabaseUrl(): void {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up`.",
    );
  }
}

// Nullable Json columns need Prisma.DbNull for SQL NULL (JS null is a type error).
function nullableJson(value: unknown) {
  return value === null || value === undefined
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}

// Create (no id) or overwrite (id passed). Cards + master are replaced wholesale
// inside one transaction: simplest correct strategy for a mutable workspace.
export async function saveWorkspace(
  input: PersistedWorkspace,
  id?: string,
): Promise<string> {
  assertDatabaseUrl();
  const rows = workspaceToRows(input);

  return db.$transaction(async (tx) => {
    const workspace = id
      ? await tx.workspace.update({
          where: { id },
          // `name` is intentionally NOT updated here: it is set once at create
          // (derived from the prompt) and changed only via renameWorkspace, so a
          // user's rename survives the next autosave.
          data: {
            phase: rows.phase,
            recipeId: rows.recipeId,
            understanding: nullableJson(rows.understanding),
            planning: nullableJson(rows.planning),
          },
        })
      : await tx.workspace.create({
          data: {
            name: rows.name,
            phase: rows.phase,
            recipeId: rows.recipeId,
            understanding: nullableJson(rows.understanding),
            planning: nullableJson(rows.planning),
          },
        });

    await tx.card.deleteMany({ where: { workspaceId: workspace.id } });
    await tx.masterAsset.deleteMany({ where: { workspaceId: workspace.id } });

    if (rows.master) {
      await tx.masterAsset.create({
        data: {
          workspaceId: workspace.id,
          assetId: rows.master.assetId,
          origin: rows.master.origin,
          sourcePrompt: rows.master.sourcePrompt,
          assetUrl: rows.master.assetUrl,
          mime: rows.master.mime,
        },
      });
    }

    if (rows.cards.length > 0) {
      await tx.card.createMany({
        data: rows.cards.map((card) => ({
          workspaceId: workspace.id,
          cardId: card.cardId,
          parentCardId: card.parentCardId,
          masterAssetId: card.masterAssetId,
          recipeId: card.recipeId,
          type: card.type,
          direction: card.direction,
          fields: card.fields as Prisma.InputJsonValue,
          references: card.references as Prisma.InputJsonValue,
          model: card.model as Prisma.InputJsonValue,
          video: nullableJson(card.video),
          promptOverride: card.promptOverride,
          vectorUrl: card.vectorUrl,
          outputs: card.outputs as Prisma.InputJsonValue,
          status: card.status,
          sortOrder: card.sortOrder,
        })),
      });
    }

    return workspace.id;
  });
}

export async function loadWorkspace(
  id: string,
): Promise<PersistedWorkspaceRecord | null> {
  assertDatabaseUrl();
  const record = await db.workspace.findUnique({
    where: { id },
    include: { master: true, cards: { orderBy: { sortOrder: "asc" } } },
  });
  if (!record) return null;

  const mapped: WorkspaceRecord = {
    id: record.id,
    name: record.name,
    phase: record.phase,
    recipeId: record.recipeId,
    understanding: record.understanding,
    planning: record.planning,
    master: record.master
      ? {
          assetId: record.master.assetId,
          origin: record.master.origin,
          sourcePrompt: record.master.sourcePrompt,
          assetUrl: record.master.assetUrl,
          mime: record.master.mime,
        }
      : null,
    cards: record.cards.map((c) => ({
      cardId: c.cardId,
      parentCardId: c.parentCardId,
      masterAssetId: c.masterAssetId,
      recipeId: c.recipeId,
      type: c.type,
      direction: c.direction,
      fields: c.fields,
      references: c.references,
      model: c.model,
      video: c.video,
      promptOverride: c.promptOverride,
      vectorUrl: c.vectorUrl,
      outputs: c.outputs,
      status: c.status,
      sortOrder: c.sortOrder,
    })),
  };
  try {
    return rowsToWorkspace(mapped);
  } catch (error) {
    // A workspace persisted before a domain-schema change (e.g. understanding or
    // planning predating the materials/mood fields) can't be mapped to current
    // types. Degrade gracefully — treat it as unrestorable rather than throwing a
    // 500 down the restore path. The store stays on a fresh session.
    console.warn(`Skipping unrestorable workspace ${id}:`, error);
    return null;
  }
}

// Gallery list: every workspace as a lightweight summary (thumbnail + phase +
// card count), newest first. One query via a nested select + relation _count.
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  assertDatabaseUrl();
  const rows = await db.workspace.findMany({
    select: {
      id: true,
      name: true,
      phase: true,
      updatedAt: true,
      master: { select: { assetUrl: true, sourcePrompt: true } },
      _count: { select: { cards: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toWorkspaceSummary);
}

// Delete a workspace; MasterAsset + Card both declare onDelete: Cascade, so this
// single delete removes the thumbnail row + all cards with it.
export async function deleteWorkspace(id: string): Promise<void> {
  assertDatabaseUrl();
  await db.workspace.delete({ where: { id } });
}

// Rename a workspace. The only writer of `name` after create — autosave leaves it
// alone (see saveWorkspace), so the new name persists.
export async function renameWorkspace(id: string, name: string): Promise<void> {
  assertDatabaseUrl();
  await db.workspace.update({ where: { id }, data: { name } });
}

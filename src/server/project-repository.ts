import { Prisma } from "@prisma/client";
import type {
  PersistedProject,
  PersistedProjectRecord,
  ProjectSummary,
} from "@/domain/persisted-project";
import { assertDatabaseUrl, db } from "@/lib/db";
import { getCurrentMaker } from "@/server/maker-repository";
import {
  type ProjectRecord,
  projectCreateData,
  projectToRows,
  projectUpdateData,
  rowsToProject,
  toProjectSummary,
} from "@/server/project-mapper";

// Nullable Json columns need Prisma.DbNull for SQL NULL (JS null is a type error).
function nullableJson(value: unknown) {
  return value === null || value === undefined
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}

function withJsonNulls<T extends { understanding: unknown; planning: unknown }>(
  data: T,
) {
  return {
    ...data,
    understanding: nullableJson(data.understanding),
    planning: nullableJson(data.planning),
  };
}

// Every query is scoped to the current maker: a project id from another maker
// reads as not found.

// Create (no id) or overwrite (id passed). Cards + master are replaced wholesale
// inside one transaction: simplest correct strategy for a mutable project. The
// update writes only projectUpdateData (never name, maker or products).
export async function saveProject(
  input: PersistedProject,
  id?: string,
): Promise<string> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = projectToRows(input);

  return db.$transaction(async (tx) => {
    const project = id
      ? await tx.project.update({
          where: { id, makerId: maker.id },
          data: withJsonNulls(projectUpdateData(rows)),
        })
      : await tx.project.create({
          data: {
            ...withJsonNulls(projectCreateData(rows)),
            makerId: maker.id,
          },
        });

    await tx.card.deleteMany({ where: { projectId: project.id } });
    await tx.masterAsset.deleteMany({ where: { projectId: project.id } });

    if (rows.master) {
      await tx.masterAsset.create({
        data: {
          projectId: project.id,
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
          projectId: project.id,
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

    return project.id;
  });
}

export async function loadProject(
  id: string,
): Promise<PersistedProjectRecord | null> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const record = await db.project.findFirst({
    where: { id, makerId: maker.id },
    include: { master: true, cards: { orderBy: { sortOrder: "asc" } } },
  });
  if (!record) return null;

  const mapped: ProjectRecord = {
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
    return rowsToProject(mapped);
  } catch (error) {
    // A project persisted before a domain-schema change (e.g. understanding or
    // planning predating the materials/mood fields) can't be mapped to current
    // types. Degrade gracefully — treat it as unrestorable rather than throwing a
    // 500 down the restore path. The store stays on a fresh session.
    console.warn(`Skipping unrestorable project ${id}:`, error);
    return null;
  }
}

// Gallery list: every project of the current maker as a lightweight summary
// (thumbnail + type + phase + card count), newest first. One query via a nested
// select + relation _count.
export async function listProjects(): Promise<ProjectSummary[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.project.findMany({
    where: { makerId: maker.id },
    select: {
      id: true,
      name: true,
      type: true,
      phase: true,
      updatedAt: true,
      master: { select: { assetUrl: true, sourcePrompt: true } },
      _count: { select: { cards: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toProjectSummary);
}

// Delete a project; MasterAsset, Card and ProjectProduct all declare onDelete:
// Cascade, so this single delete removes the thumbnail row + all cards with it.
export async function deleteProject(id: string): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.project.delete({ where: { id, makerId: maker.id } });
}

// Rename a project. The only writer of `name` after create — autosave leaves it
// alone (see saveProject), so the new name persists.
export async function renameProject(id: string, name: string): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.project.update({ where: { id, makerId: maker.id }, data: { name } });
}

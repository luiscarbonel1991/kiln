import { Prisma } from "@prisma/client";
import { Card } from "@/domain/card";
import type { MasterAsset } from "@/domain/master-asset";
import type {
  PersistedProject,
  PersistedProjectRecord,
  ProjectSummary,
} from "@/domain/persisted-project";
import {
  approveSlot,
  moveSlot,
  ProjectPlan,
  type SlotMove,
  type SlotRef,
  slotCardId,
  unapproveSlot,
  withDelivered,
  withSlotOff,
} from "@/domain/plan";
import type { Product } from "@/domain/product";
import type { ProjectType } from "@/domain/project";
import { ACTIVE_JOB_STATUSES } from "@/domain/queue";
import { assertDatabaseUrl, db } from "@/lib/db";
import { getCurrentMaker } from "@/server/maker-repository";
import { rowToProduct } from "@/server/product-mapper";
import {
  type CardRow,
  cardsToRows,
  editorCardColumns,
  type MasterAssetRow,
  masterToRow,
  type ProjectBoard,
  type ProjectRecord,
  projectCreateData,
  projectToRows,
  projectUpdateData,
  rowsToBoard,
  rowsToProject,
  studioProjectType,
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

function masterData(projectId: string, master: MasterAssetRow) {
  return {
    projectId,
    assetId: master.assetId,
    origin: master.origin,
    sourcePrompt: master.sourcePrompt,
    assetUrl: master.assetUrl,
    mime: master.mime,
  };
}

function cardData(projectId: string, cards: CardRow[]) {
  return cards.map((card) => ({
    projectId,
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
  }));
}

// Every query is scoped to the current maker: a project id from another maker
// reads as not found.

// Create (no id) or overwrite (id passed), in one transaction. The update writes
// only projectUpdateData (never name, maker, products or plan). A studio
// project's master and cards are then replaced wholesale (no worker writes
// there). A planned project's are not: its cards and reference are created by
// the server and its generation state is written by the queue, so the editor
// only updates the columns it owns on cards that exist (editorCardColumns) —
// a stale editor tab can never revert a result, the reference or the card set.
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

    if (project.plan !== null) {
      for (const card of rows.cards) {
        const columns = editorCardColumns(card);
        await tx.card.updateMany({
          where: { projectId: project.id, cardId: card.cardId },
          data: {
            ...columns,
            fields: columns.fields as Prisma.InputJsonValue,
            references: columns.references as Prisma.InputJsonValue,
            model: columns.model as Prisma.InputJsonValue,
            video: nullableJson(columns.video),
          },
        });
      }
      return project.id;
    }

    // A studio project's type follows its recipe; a planned project's type was
    // chosen in the New project flow and is left alone.
    if (id) {
      await tx.project.update({
        where: { id: project.id },
        data: { type: studioProjectType(rows.recipeId) },
      });
    }

    await tx.card.deleteMany({ where: { projectId: project.id } });
    await tx.masterAsset.deleteMany({ where: { projectId: project.id } });
    if (rows.master) {
      await tx.masterAsset.create({
        data: masterData(project.id, rows.master),
      });
    }
    if (rows.cards.length > 0) {
      await tx.card.createMany({ data: cardData(project.id, rows.cards) });
    }
    return project.id;
  });
}

// A project started from the New project flow: its type, product and plan are
// fixed here, with the editor state (understanding, cards, master) the start
// produced. One transaction.
export async function createProject(input: {
  type: ProjectType;
  productId: string;
  plan: ProjectPlan;
  editor: PersistedProject;
}): Promise<string> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = projectToRows(input.editor);
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        ...withJsonNulls(projectUpdateData(rows)),
        name: rows.name,
        type: input.type,
        plan: input.plan as unknown as Prisma.InputJsonValue,
        makerId: maker.id,
        products: { create: { productId: input.productId, position: 0 } },
      },
    });
    if (rows.master) {
      await tx.masterAsset.create({
        data: masterData(project.id, rows.master),
      });
    }
    if (rows.cards.length > 0) {
      await tx.card.createMany({ data: cardData(project.id, rows.cards) });
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
      plan: true,
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
// Delete a project. Its queued jobs are canceled in the same transaction, so
// the worker never pays for scenes nobody can see; a job already in its paid
// call finishes, keeps its cost, and its output is dropped. The jobs' rows stay
// (projectId set null) so the month's spend is kept.
export async function deleteProject(id: string): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    // The project row first (enqueueBatch locks it too): a concurrent enqueue
    // waits, then finds the project gone, so no job is queued for it after
    // the cancel below.
    await tx.$queryRaw`
      SELECT "id" FROM "Project"
      WHERE "id" = ${id} AND "makerId" = ${maker.id} FOR UPDATE`;
    const now = new Date();
    await tx.generationJob.updateMany({
      where: { projectId: id, makerId: maker.id, status: "queued" },
      data: { status: "canceled", finishedAt: now },
    });
    await tx.generationBatch.updateMany({
      where: { projectId: id, makerId: maker.id, canceledAt: null },
      data: { canceledAt: now },
    });
    await tx.project.delete({ where: { id, makerId: maker.id } });
  });
}

// Rename a project. The only writer of `name` after create — autosave leaves it
// alone (see saveProject), so the new name persists.
export async function renameProject(id: string, name: string): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.project.update({ where: { id, makerId: maker.id }, data: { name } });
}

// Persist one generation result straight to its card, outside the editor's
// autosave: a paid result is kept even when the editor that asked for it is
// gone (another project opened, the page left). Studio projects only: a
// planned project's results are written by the queue. updateMany never throws if a
// concurrent autosave is replacing the card rows; that autosave then carries the
// result from the store.
export async function saveCardOutput(
  projectId: string,
  cardId: string,
  url: string,
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.card.updateMany({
    where: {
      projectId,
      cardId,
      project: { makerId: maker.id, plan: { equals: Prisma.DbNull } },
    },
    data: { outputs: [url], status: "done", vectorUrl: null },
  });
}

const CARD_COLUMNS = {
  cardId: true,
  parentCardId: true,
  masterAssetId: true,
  recipeId: true,
  type: true,
  direction: true,
  fields: true,
  references: true,
  model: true,
  video: true,
  promptOverride: true,
  vectorUrl: true,
  outputs: true,
  status: true,
  sortOrder: true,
} as const;

// The board's read: project + plan + product + anchor + cards, or null.
export async function loadProjectBoard(
  id: string,
): Promise<{ board: ProjectBoard; product: Product | null } | null> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const record = await db.project.findFirst({
    where: { id, makerId: maker.id },
    select: {
      id: true,
      name: true,
      type: true,
      plan: true,
      master: {
        select: {
          assetId: true,
          origin: true,
          sourcePrompt: true,
          assetUrl: true,
          mime: true,
        },
      },
      cards: { select: CARD_COLUMNS, orderBy: { sortOrder: "asc" } },
      products: {
        orderBy: { position: "asc" },
        take: 1,
        select: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              spec: true,
              source: true,
            },
          },
        },
      },
    },
  });
  if (!record) return null;
  const productRow = record.products[0]?.product;
  return {
    board: rowsToBoard(record),
    product: productRow ? rowToProduct(productRow) : null,
  };
}

const CardState = Card.pick({ status: true, outputs: true });

// Approve (or withdraw approval of) a scene slot's current output. The project
// row is locked for the read-modify-write of the plan, so two quick approvals
// on different slots both land. The card is read from the database, never
// trusted from the client.
export async function setSlotApproval(
  projectId: string,
  ref: SlotRef,
  approved: boolean,
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { plan: true },
    });
    const plan = ProjectPlan.parse(project.plan);
    const row = await tx.card.findUnique({
      where: {
        projectId_cardId: {
          projectId,
          cardId: slotCardId(ref.destinationId, ref.slotKey),
        },
      },
      select: { status: true, outputs: true },
    });
    const card = row ? CardState.safeParse(row) : undefined;
    const next = approved
      ? approveSlot(plan, ref, card?.success ? card.data : undefined)
      : unapproveSlot(plan, ref);
    await tx.project.update({
      where: { id: projectId },
      data: { plan: next as unknown as Prisma.InputJsonValue },
    });
  });
}

// Switch a slot off (out of the deliverable: never generated, not counted) or
// back on. Locked like approvals; enqueueBatch takes the same lock, so a scene
// is never queued as it is switched off. A scene with a job queued or running
// cannot be switched off (cancel the batch first).
export async function setSlotOff(
  projectId: string,
  ref: SlotRef,
  off: boolean,
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { plan: true },
    });
    const plan = ProjectPlan.parse(project.plan);
    if (off) {
      const busy = await tx.generationJob.count({
        where: {
          projectId,
          cardId: slotCardId(ref.destinationId, ref.slotKey),
          status: { in: ACTIVE_JOB_STATUSES },
        },
      });
      if (busy > 0) {
        throw new Error(
          "This scene is in the queue; switch it off when it is done.",
        );
      }
    }
    await tx.project.update({
      where: { id: projectId },
      data: {
        plan: withSlotOff(plan, ref, off) as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// Reorder a destination's slots (the photo order). Locked like approvals.
export async function setSlotOrder(
  projectId: string,
  ref: SlotRef,
  move: SlotMove,
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { plan: true },
    });
    const plan = ProjectPlan.parse(project.plan);
    await tx.project.update({
      where: { id: projectId },
      data: {
        plan: moveSlot(plan, ref, move) as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// Stamp the slots a delivery exported (withDelivered: a scene only if the
// output it exported is still the approved one). Locked like approvals.
export async function setDelivered(
  projectId: string,
  destinationId: string,
  delivered: { key: string; approvedOutput?: string }[],
  at: string,
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { plan: true },
    });
    const plan = ProjectPlan.parse(project.plan);
    await tx.project.update({
      where: { id: projectId },
      data: {
        plan: withDelivered(
          plan,
          destinationId,
          delivered,
          at,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// Set a planned project's reference image (the anchor every scene edits). The
// first reference also creates the scene slots' draft cards; a later one only
// re-points the existing cards at it. Locked like approvals.
export async function setProjectReference(
  projectId: string,
  master: MasterAsset,
  firstCards: Card[],
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    await tx.masterAsset.deleteMany({ where: { projectId } });
    await tx.masterAsset.create({
      data: masterData(projectId, masterToRow(master)),
    });
    const existing = await tx.card.count({ where: { projectId } });
    if (existing === 0) {
      if (firstCards.length > 0) {
        await tx.card.createMany({
          data: cardData(projectId, cardsToRows(firstCards)),
        });
      }
    } else {
      await tx.card.updateMany({
        where: { projectId },
        data: { masterAssetId: master.id },
      });
    }
    await tx.project.update({
      where: { id: projectId },
      data: { phase: "generation" },
    });
  });
}

import { Prisma } from "@prisma/client";
import { Card } from "@/domain/card";
import type { DestinationText } from "@/domain/destination";
import { modelPriced } from "@/domain/generation-cost";
import { type ListingText, refreshListing } from "@/domain/listing";
import type { MarketBrief } from "@/domain/market-brief";
import type { MasterAsset } from "@/domain/master-asset";
import { assertModel, ModelRefused } from "@/domain/model-defaults";
import type {
  PersistedProject,
  PersistedProjectRecord,
  ProjectSummary,
} from "@/domain/persisted-project";
import {
  addVideoSlot,
  approveSlot,
  moveSlot,
  type PlanSlot,
  ProjectPlan,
  type SlotMove,
  type SlotRef,
  SlotRefusal,
  slotCardId,
  unapproveSlot,
  withBrief,
  withDelivered,
  withListing,
  withSlotOff,
  withVideoChoice,
} from "@/domain/plan";
import { Product } from "@/domain/product";
import type { ProjectType } from "@/domain/project";
import { ACTIVE_JOB_STATUSES } from "@/domain/queue";
import type { ShotList } from "@/domain/shot-list";
import { BaseUnderstanding } from "@/domain/understanding";
import type { VideoChoice } from "@/domain/video";
import { assertDatabaseUrl, db } from "@/lib/db";
import { freshFields, retuneFields } from "@/lib/project-refresh";
import { getCurrentMaker } from "@/server/maker-repository";
import { rowToProduct } from "@/server/product-mapper";
import { productHash } from "@/server/product-version";
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

// What a studio card keeps of the server's writes when the editor saves it: a
// take the editor never saw (the queue drew it, or the editor's own request
// settled after this state was read) and a vector traced on the server for
// the take the editor shows. The editor still owns the card set and every
// other column.
function keepServerResults(
  incoming: CardRow,
  saved:
    | { outputs: unknown; status: string; vectorUrl: string | null }
    | undefined,
): CardRow {
  if (!saved) return incoming;
  const take = Array.isArray(saved.outputs) ? saved.outputs[0] : undefined;
  if (typeof take !== "string") return incoming;
  const shown = Array.isArray(incoming.outputs) ? incoming.outputs : [];
  if (!shown.includes(take)) {
    return {
      ...incoming,
      outputs: saved.outputs,
      status: saved.status,
      vectorUrl: saved.vectorUrl,
    };
  }
  if (shown[0] === take && !incoming.vectorUrl && saved.vectorUrl) {
    return { ...incoming, vectorUrl: saved.vectorUrl };
  }
  return incoming;
}

// Create (no id) or overwrite (id passed), in one transaction. The update writes
// only projectUpdateData (never name, maker, products or plan). A studio
// project's master and cards are then replaced wholesale, keeping what the
// server wrote since the editor read them (keepServerResults: the queue draws
// a design's line art, the server traces its vector). A planned project's are
// not: its cards and reference are created by
// the server and its generation state is written by the queue, so the editor
// only updates the columns it owns on cards that exist (editorCardColumns) —
// a stale editor tab can never revert a result, the reference or the card set.
// A card's vector belongs to the output it traced: it is written only while
// the card still shows the outputs the editor saw, so a stale tab cannot put
// back a vector the worker cleared with a new output.
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
        const { vectorUrl, ...columns } = editorCardColumns(card);
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
        await tx.card.updateMany({
          where: {
            projectId: project.id,
            cardId: card.cardId,
            outputs: { equals: card.outputs as Prisma.InputJsonValue },
          },
          data: { vectorUrl },
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

    const saved = new Map(
      (
        await tx.card.findMany({
          where: { projectId: project.id },
          select: {
            cardId: true,
            outputs: true,
            status: true,
            vectorUrl: true,
          },
        })
      ).map((c) => [c.cardId, c]),
    );
    await tx.card.deleteMany({ where: { projectId: project.id } });
    await tx.masterAsset.deleteMany({ where: { projectId: project.id } });
    if (rows.master) {
      await tx.masterAsset.create({
        data: masterData(project.id, rows.master),
      });
    }
    if (rows.cards.length > 0) {
      await tx.card.createMany({
        data: cardData(
          project.id,
          rows.cards.map((c) => keepServerResults(c, saved.get(c.cardId))),
        ),
      });
    }
    return project.id;
  });
}

// A project started from the New project flow: its type, product and plan are
// fixed here, with the editor state (understanding, cards, master) the start
// produced, and the product as it was (its version: a later change shows on
// the board). One transaction.
export async function createProject(input: {
  type: ProjectType;
  product: Product;
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
        products: {
          create: {
            productId: input.product.id,
            position: 0,
            productSnapshot: input.product as unknown as Prisma.InputJsonValue,
            productHash: productHash(input.product),
          },
        },
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

// A studio card's vector, traced on the server from the take it shows: kept
// only while the card still shows that take (a newer take clears the vector,
// so a late trace never lands on it). False when nothing was written.
export async function setCardVector(
  projectId: string,
  cardId: string,
  take: string,
  vectorUrl: string,
): Promise<boolean> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const written = await db.card.updateMany({
    where: {
      projectId,
      cardId,
      outputs: { equals: [take] },
      project: { makerId: maker.id, plan: { equals: Prisma.DbNull } },
    },
    data: { vectorUrl },
  });
  return written.count === 1;
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

// Which version of its product a project was built from: the product as it
// was then and its hash (null on projects started before versions were
// kept, read from the dates instead).
export interface ProjectProductVersion {
  snapshot: unknown;
  hash: string | null;
  productUpdatedAt: Date;
  projectCreatedAt: Date;
}

// The board's read: project + plan + product + anchor + cards, or null.
export async function loadProjectBoard(id: string): Promise<{
  board: ProjectBoard;
  product: Product | null;
  version: ProjectProductVersion | null;
} | null> {
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
      createdAt: true,
      products: {
        orderBy: { position: "asc" },
        take: 1,
        select: {
          productSnapshot: true,
          productHash: true,
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              spec: true,
              source: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });
  if (!record) return null;
  const link = record.products[0];
  return {
    board: rowsToBoard(record),
    product: link ? rowToProduct(link.product) : null,
    version: link
      ? {
          snapshot: link.productSnapshot,
          hash: link.productHash,
          productUpdatedAt: link.product.updatedAt,
          projectCreatedAt: record.createdAt,
        }
      : null,
  };
}

const CardState = Card.pick({ status: true, outputs: true });

// Approve (or withdraw approval of) a scene slot's current output. The project
// row is locked for the read-modify-write of the plan, so two quick approvals
// on different slots both land. The card is read from the database, never
// trusted from the client. `checked` is the take the caller looked at (an
// agent after its QC): a newer take landed since is refused, not approved
// unseen.
export async function setSlotApproval(
  projectId: string,
  ref: SlotRef,
  approved: boolean,
  checked?: string,
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
    const parsed = ProjectPlan.safeParse(project.plan);
    if (!parsed.success) {
      throw new SlotRefusal("missing", "That project has no frames.");
    }
    const plan = parsed.data;
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
    const current = card?.success ? card.data.outputs[0] : undefined;
    if (approved && checked !== undefined && current !== checked) {
      throw new SlotRefusal(
        "stale",
        current
          ? `A newer take landed since: ${current}. Check it, then approve that one.`
          : "That take is not the frame's latest: it has no finished take now.",
      );
    }
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
// Save a destination's listing text in the plan. Locked like approvals, so a
// save never drops an approval landing at the same time.
export async function setListing(
  projectId: string,
  destinationId: string,
  listing: ListingText,
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
        plan: withListing(
          plan,
          destinationId,
          listing,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// Save one destination's market brief (none: the brief is cleared).
export async function setBrief(
  projectId: string,
  destinationId: string,
  brief: MarketBrief | undefined,
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
        plan: withBrief(
          plan,
          destinationId,
          brief,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// Change a planned project's plan under its row lock (a listing's read, its
// address, the day it went live): the change sees the plan as stored, so an
// agent's read and the maker's click do not undo each other.
export async function changePlan(
  projectId: string,
  change: (plan: ProjectPlan) => ProjectPlan,
): Promise<ProjectPlan> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { plan: true },
    });
    if (!project.plan) throw new Error("project not found");
    const next = ProjectPlan.parse(change(ProjectPlan.parse(project.plan)));
    await tx.project.update({
      where: { id: projectId },
      data: { plan: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  });
}

// The last market brief kept for a product on each destination, with the
// project it is in: a new project of the product starts from it.
export async function latestBriefs(
  productId: string,
): Promise<Record<string, { brief: MarketBrief; projectName: string }>> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.project.findMany({
    where: { makerId: maker.id, products: { some: { productId } } },
    select: { name: true, plan: true },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });
  const found: Record<string, { brief: MarketBrief; projectName: string }> = {};
  for (const row of rows) {
    const plan = ProjectPlan.safeParse(row.plan);
    if (!plan.success) continue;
    for (const d of plan.data.destinations) {
      if (found[d.destinationId] || !d.brief) continue;
      if (d.brief.searches.length === 0 && d.brief.notes.length === 0) continue;
      found[d.destinationId] = { brief: d.brief, projectName: row.name };
    }
  }
  return found;
}

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

// Tune a scene slot (one of its knobs, its own place), and write the
// direction it makes into the slot's card: `derive` builds the card from the locked plan and the product
// version the project follows (an unreviewed product change waits for Update
// the project). Refused while the scene is in the queue, and while it is
// approved: its words must keep describing the approved picture, which the
// video starts from. Locked like approvals; one transaction.
export async function setSlotTuning(
  projectId: string,
  ref: SlotRef,
  tune: (plan: ProjectPlan) => ProjectPlan,
  derive: (input: {
    plan: ProjectPlan;
    master: MasterAsset;
    product: Product;
  }) => Card | undefined,
  // "direction": a knob or a place rewrites the scene's direction only;
  // "card": a colour or style rewrites the whole card in it (its product
  // fields and its material sample), the maker's own fields kept.
  rewrite: "direction" | "card" = "direction",
): Promise<{ product: Product | null; plan: ProjectPlan }> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        plan: true,
        master: true,
        products: {
          orderBy: { position: "asc" },
          take: 1,
          select: {
            productSnapshot: true,
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
    const plan = ProjectPlan.parse(project.plan);
    const cardId = slotCardId(ref.destinationId, ref.slotKey);
    const busy = await tx.generationJob.count({
      where: { projectId, cardId, status: { in: ACTIVE_JOB_STATUSES } },
    });
    if (busy > 0) {
      throw new Error("This scene is in the queue; tune it when it is done.");
    }
    const card = await tx.card.findUnique({
      where: { projectId_cardId: { projectId, cardId } },
      select: { fields: true, outputs: true },
    });
    const slot = plan.destinations
      .find((d) => d.destinationId === ref.destinationId)
      ?.slots.find((s) => s.key === ref.slotKey);
    const outputs = Card.shape.outputs.safeParse(card?.outputs);
    if (
      slot?.approvedOutput &&
      outputs.success &&
      outputs.data[0] === slot.approvedOutput
    ) {
      throw new Error("Undo the approval to tune this scene.");
    }
    const next = tune(plan);
    const link = project.products[0];
    const snapshot = Product.safeParse(link?.productSnapshot);
    const product = snapshot.success
      ? snapshot.data
      : link
        ? rowToProduct(link.product)
        : null;
    if (project.master && card && product) {
      const derived = derive({
        plan: next,
        master: {
          id: project.master.assetId,
          origin: project.master.origin as MasterAsset["origin"],
          sourcePrompt: project.master.sourcePrompt,
          assetUrl: project.master.assetUrl,
          mime: project.master.mime,
        },
        product,
      });
      const fields = Card.shape.fields.parse(card.fields);
      if (derived) {
        await tx.card.update({
          where: { projectId_cardId: { projectId, cardId } },
          data:
            rewrite === "card"
              ? {
                  fields: freshFields(
                    fields,
                    derived.fields,
                  ) as unknown as Prisma.InputJsonValue,
                  references:
                    derived.references as unknown as Prisma.InputJsonValue,
                }
              : {
                  fields: retuneFields(
                    fields,
                    derived.fields,
                  ) as unknown as Prisma.InputJsonValue,
                },
        });
      }
    }
    await tx.project.update({
      where: { id: projectId },
      data: { plan: next as unknown as Prisma.InputJsonValue },
    });
    return { product, plan: next };
  });
}

// Change a video slot's choices (start frame, motion, length, orientation).
// Locked like approvals.
export async function setVideoChoice(
  projectId: string,
  ref: SlotRef,
  choice: VideoChoice,
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
        plan: withVideoChoice(
          plan,
          ref,
          choice,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

// Switch one card to another model (the board's per-slot choice): one Kiln
// offers for the card's kind, with a pinned price. Only the model's identity
// and what prices it change (quality, resolution); its aspect and tuning stay.
// A job already queued keeps the request it snapshotted.
export async function setCardModel(
  projectId: string,
  cardId: string,
  model: {
    provider: "google" | "openai";
    model: string;
    quality?: "low" | "medium" | "high";
    resolution?: "720p" | "1080p";
  },
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    const row = await tx.card.findUnique({
      where: { projectId_cardId: { projectId, cardId } },
      select: { type: true, model: true },
    });
    if (!row) throw new Error(`card "${cardId}" not found`);
    const kind = row.type === "video" ? "video" : "image";
    const entry = assertModel(model, kind);
    if (!modelPriced(model, kind)) {
      throw new ModelRefused(`${entry.label} has no pinned price.`);
    }
    const {
      quality: _q,
      resolution: _r,
      ...kept
    } = row.model as Record<string, unknown>;
    await tx.card.update({
      where: { projectId_cardId: { projectId, cardId } },
      data: {
        model: {
          ...kept,
          provider: model.provider,
          model: model.model,
          ...(entry.qualities && model.quality
            ? { quality: model.quality }
            : {}),
          ...(entry.seconds && model.resolution
            ? { resolution: model.resolution }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });
  });
}

// Give a plan made before video its destination's video slot and the slot's
// card (built by `makeCard` from the project's reference and understanding).
// Locked like approvals; refused without a reference image.
export async function addVideoToPlan(
  projectId: string,
  destinationId: string,
  shotLists: ShotList[],
  makeCard: (
    slot: PlanSlot,
    shotListId: string,
    master: MasterAsset,
    understanding: BaseUnderstanding,
  ) => Card,
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
      select: { plan: true, understanding: true, master: true },
    });
    const plan = ProjectPlan.parse(project.plan);
    const added = addVideoSlot(plan, destinationId, shotLists);
    if (!added) throw new Error("This destination already has its video.");
    const understanding = BaseUnderstanding.safeParse(project.understanding);
    if (!project.master || !understanding.success) {
      throw new Error("Add the product's reference image first.");
    }
    const destination = plan.destinations.find(
      (d) => d.destinationId === destinationId,
    );
    const card = makeCard(
      added.slot,
      destination?.shotListId ?? "",
      {
        id: project.master.assetId,
        origin: project.master.origin as MasterAsset["origin"],
        sourcePrompt: project.master.sourcePrompt,
        assetUrl: project.master.assetUrl,
        mime: project.master.mime,
      },
      understanding.data,
    );
    const sortOrder = await tx.card.count({ where: { projectId } });
    const [row] = cardData(projectId, cardsToRows([card]));
    await tx.card.create({ data: { ...row, sortOrder } });
    await tx.project.update({
      where: { id: projectId },
      data: { plan: added.plan as unknown as Prisma.InputJsonValue },
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

// Bring a planned project up to its product's current version: the
// understanding written from the product, the reference when Kiln makes one
// (null keeps the maker's), each card's fields and references (refreshCards:
// the material sample), each saved listing's spec fields, and the version the
// project now follows. Locked like approvals; one transaction.
export async function refreshProjectProduct(
  projectId: string,
  input: {
    product: Product;
    understanding: BaseUnderstanding;
    master: MasterAsset | null;
    cards: Card[];
    // A destination's text rules: its saved listing's spec fields are
    // drafted again from the product (refreshListing).
    textRules?: (destinationId: string) => DestinationText | undefined;
    // The plan the new version implies (replan), applied to the locked plan.
    replan?: (plan: ProjectPlan) => ProjectPlan;
  },
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${maker.id}
      FOR UPDATE`;
    if (locked.length === 0) throw new Error("project not found");
    if (input.master) {
      await tx.masterAsset.deleteMany({ where: { projectId } });
      await tx.masterAsset.create({
        data: masterData(projectId, masterToRow(input.master)),
      });
    }
    for (const card of input.cards) {
      await tx.card.update({
        where: { projectId_cardId: { projectId, cardId: card.id } },
        data: {
          fields: card.fields as Prisma.InputJsonValue,
          references: card.references as Prisma.InputJsonValue,
          masterAssetId: card.masterAssetId,
        },
      });
    }
    const row = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { plan: true },
    });
    const parsed = ProjectPlan.safeParse(row.plan);
    const plan =
      parsed.success && input.replan
        ? { success: true as const, data: input.replan(parsed.data) }
        : parsed;
    const listed = plan.success
      ? {
          ...plan.data,
          destinations: plan.data.destinations.map((d) => {
            const rules = input.textRules?.(d.destinationId);
            return d.listing && rules
              ? {
                  ...d,
                  listing: refreshListing(d.listing, input.product, rules),
                }
              : d;
          }),
        }
      : null;
    await tx.project.update({
      where: { id: projectId },
      data: {
        understanding: input.understanding as unknown as Prisma.InputJsonValue,
        ...(listed ? { plan: listed as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await tx.projectProduct.update({
      where: {
        projectId_productId: { projectId, productId: input.product.id },
      },
      data: {
        productSnapshot: input.product as unknown as Prisma.InputJsonValue,
        productHash: productHash(input.product),
      },
    });
  });
}

// Set a planned project's reference image (the anchor every scene edits). The
// first reference also creates the scene slots' draft cards; a later one
// re-points the existing cards at it, and rewrites the ones given (`rewritten`:
// their fields and references, as refreshCards leaves them). Locked like
// approvals.
export async function setProjectReference(
  projectId: string,
  master: MasterAsset,
  firstCards: Card[],
  rewritten: Card[] = [],
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
      for (const card of rewritten) {
        await tx.card.update({
          where: { projectId_cardId: { projectId, cardId: card.id } },
          data: {
            fields: card.fields as Prisma.InputJsonValue,
            references: card.references as Prisma.InputJsonValue,
            masterAssetId: card.masterAssetId,
          },
        });
      }
    }
    await tx.project.update({
      where: { id: projectId },
      data: { phase: "generation" },
    });
  });
}

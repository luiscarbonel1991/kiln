import { Prisma } from "@prisma/client";
import { isActiveJob } from "@/domain/queue";
import { db } from "@/lib/db";
import { findRecipe } from "@/lib/recipes";
import { projectGenerationState } from "@/server/generation-repository";
import { getCurrentMaker } from "@/server/maker-repository";

// A maker's design projects as the tools read them (ROADMAP "Agents", the SVG
// specialist): a design starts in the studio from an image, has no plan and
// no frames, and each of its drawings is a line-art card that is drawn (the
// image model, paid), then traced into an SVG (free). The studio's editor and
// the tools share these rows: the queue draws, the server traces, and the
// editor's autosave keeps both (saveProject).

export type DrawingState =
  | "to-draw"
  | "drawing"
  | "drawn"
  | "vectorized"
  | "failed";

export interface DrawingView {
  card: string;
  label: string;
  purpose?: string;
  state: DrawingState;
  lineArt?: string;
  vector?: string;
  // Where the maker turns the vector into a product (their size, material
  // and colours, in the product form).
  makeProduct?: string;
  failed?: string;
}

export interface DesignView {
  project: { id: string; name: string; updatedAt: string };
  // The image the design was drawn from, and what Kiln read in it.
  master: string | null;
  subject: string | null;
  drawings: DrawingView[];
}

export interface DesignSummary {
  id: string;
  name: string;
  updatedAt: string;
  drawings: number;
  drawn: number;
  vectorized: number;
}

const DESIGN = { type: "design", plan: { equals: Prisma.DbNull } } as const;

const takeOf = (outputs: unknown): string | undefined =>
  Array.isArray(outputs) && typeof outputs[0] === "string"
    ? outputs[0]
    : undefined;

export const makeProductHref = (vectorUrl: string) =>
  `/projects/new?design=${encodeURIComponent(vectorUrl)}`;

export async function isDesign(projectId: string): Promise<boolean> {
  const maker = await getCurrentMaker();
  const row = await db.project.findFirst({
    where: { id: projectId, makerId: maker.id, ...DESIGN },
    select: { id: true },
  });
  return row !== null;
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const maker = await getCurrentMaker();
  const rows = await db.project.findMany({
    where: { makerId: maker.id, ...DESIGN },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      updatedAt: true,
      cards: {
        where: { type: "image" },
        select: { outputs: true, vectorUrl: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updatedAt.toISOString(),
    drawings: r.cards.length,
    drawn: r.cards.filter((c) => takeOf(c.outputs)).length,
    vectorized: r.cards.filter((c) => takeOf(c.outputs) && c.vectorUrl).length,
  }));
}

// One design with each drawing's state: in the queue, drawn, traced, or
// failed (its last drawing's error, until a take lands).
export async function designView(
  projectId: string,
): Promise<DesignView | null> {
  const maker = await getCurrentMaker();
  const row = await db.project.findFirst({
    where: { id: projectId, makerId: maker.id, ...DESIGN },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      understanding: true,
      master: { select: { assetUrl: true } },
      cards: {
        where: { type: "image" },
        orderBy: { sortOrder: "asc" },
        select: {
          cardId: true,
          direction: true,
          recipeId: true,
          outputs: true,
          vectorUrl: true,
          status: true,
        },
      },
    },
  });
  if (!row) return null;
  const { jobs } = await projectGenerationState(maker.id, row.id);
  const subject = (row.understanding as { subject?: unknown } | null)?.subject;
  return {
    project: {
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt.toISOString(),
    },
    master: row.master?.assetUrl ?? null,
    subject: typeof subject === "string" && subject ? subject : null,
    drawings: row.cards.map((card): DrawingView => {
      const job = jobs[card.cardId];
      const lineArt = takeOf(card.outputs);
      const vector = lineArt ? (card.vectorUrl ?? undefined) : undefined;
      const purpose = findRecipe(card.recipeId)?.directions.find(
        (d) => d.label === card.direction,
      )?.purpose;
      const failed =
        !lineArt && job?.status === "failed" ? (job.error ?? "failed") : null;
      const state: DrawingState = isActiveJob(job)
        ? "drawing"
        : vector
          ? "vectorized"
          : lineArt
            ? "drawn"
            : failed || card.status === "error"
              ? "failed"
              : "to-draw";
      return {
        card: card.cardId,
        label: card.direction,
        ...(purpose ? { purpose } : {}),
        state,
        ...(lineArt ? { lineArt } : {}),
        ...(vector ? { vector, makeProduct: makeProductHref(vector) } : {}),
        ...(failed ? { failed } : {}),
      };
    }),
  };
}

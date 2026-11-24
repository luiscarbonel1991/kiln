import { Card } from "@/domain/card";
import {
  type FrameView,
  frameSlots,
  frameViews,
  waitingFrames,
} from "@/domain/frame-view";
import { type CardLike, ProjectPlan } from "@/domain/plan";
import { Product } from "@/domain/product";
import type { TakeCheck } from "@/domain/qc";
import { assertDatabaseUrl, db } from "@/lib/db";
import {
  outputFacts,
  projectGenerationState,
} from "@/server/generation-repository";
import type { MakerRef } from "@/server/maker-repository";
import { rowToProduct } from "@/server/product-mapper";

// A project's frames as an agent reads them (README "HTTP API"): what the
// board shows, without the board.

export interface ProjectFrames {
  project: { id: string; name: string; type: string; phase: string };
  frames: FrameView[];
}

const CardState = Card.pick({ status: true, outputs: true });

// A project's plan, cards and jobs, as its frames are read from them. Null
// for a project the current maker does not have, or one with no plan (a
// studio project: it has no frames).
async function loadFrames(maker: MakerRef, projectId: string) {
  assertDatabaseUrl();
  const project = await db.project.findFirst({
    where: { id: projectId, makerId: maker.id },
    select: {
      id: true,
      name: true,
      type: true,
      phase: true,
      plan: true,
      master: { select: { assetUrl: true } },
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
  const plan = project ? ProjectPlan.safeParse(project.plan) : null;
  if (!project || !plan?.success) return null;
  const state = await projectGenerationState(maker, projectId);
  const cards: Record<string, CardLike> = {};
  for (const [id, card] of Object.entries(state.cards)) {
    const parsed = CardState.safeParse(card);
    if (parsed.success) cards[id] = parsed.data;
  }
  const { plan: _plan, master, products, ...summary } = project;
  // The version of the product the project follows.
  const link = products[0];
  const product = link
    ? (Product.safeParse(link.productSnapshot).data ??
      rowToProduct(link.product) ??
      undefined)
    : undefined;
  // What Kiln read in each shown take (null: the job left no check).
  const shown = Object.values(cards).flatMap((c) => c.outputs.slice(0, 1));
  const facts = await outputFacts(maker, projectId, shown);
  const checks: Record<string, TakeCheck | null> = {};
  for (const [id, card] of Object.entries(cards)) {
    const fact = card.outputs[0] ? facts.get(card.outputs[0]) : undefined;
    if (fact) checks[id] = fact.check;
  }
  return {
    project: summary,
    plan: plan.data,
    product,
    cards,
    jobs: state.jobs,
    checks,
    reference: master !== null,
  };
}

export async function projectFrames(
  maker: MakerRef,
  projectId: string,
): Promise<ProjectFrames | null> {
  const loaded = await loadFrames(maker, projectId);
  if (!loaded) return null;
  const { project, plan, cards, jobs, product, checks } = loaded;
  return { project, frames: frameViews(plan, cards, jobs, product, checks) };
}

// The scene frames a batch would generate now, as the board's Generate picks
// them, and whether the project has its reference image (no scene has a card
// to generate from without it); null as projectFrames.
export async function waitingProjectFrames(
  maker: MakerRef,
  projectId: string,
): Promise<{ waiting: string[]; reference: boolean } | null> {
  const loaded = await loadFrames(maker, projectId);
  if (!loaded) return null;
  return {
    waiting: waitingFrames(frameSlots(loaded.plan, loaded.cards, loaded.jobs)),
    reference: loaded.reference,
  };
}

// The current maker's projects that have frames (started from New project),
// newest first: what `kiln projects` lists.
export async function framedProjects(
  maker: MakerRef,
): Promise<(ProjectFrames["project"] & { updatedAt: string })[]> {
  assertDatabaseUrl();
  const rows = await db.project.findMany({
    where: { makerId: maker.id },
    select: {
      id: true,
      name: true,
      type: true,
      phase: true,
      plan: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows
    .filter((r) => ProjectPlan.safeParse(r.plan).success)
    .map(({ plan: _plan, updatedAt, ...r }) => ({
      ...r,
      updatedAt: updatedAt.toISOString(),
    }));
}

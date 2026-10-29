import { Card } from "@/domain/card";
import { type FrameView, frameViews } from "@/domain/frame-view";
import { type CardLike, ProjectPlan } from "@/domain/plan";
import { assertDatabaseUrl, db } from "@/lib/db";
import { projectGenerationState } from "@/server/generation-repository";
import { getCurrentMaker } from "@/server/maker-repository";

// A project's frames as an agent reads them (README "HTTP API"): what the
// board shows, without the board.

export interface ProjectFrames {
  project: { id: string; name: string; type: string; phase: string };
  frames: FrameView[];
}

const CardState = Card.pick({ status: true, outputs: true });

// Null for a project the current maker does not have, or one with no plan
// (a studio project: it has no frames).
export async function projectFrames(
  projectId: string,
): Promise<ProjectFrames | null> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const project = await db.project.findFirst({
    where: { id: projectId, makerId: maker.id },
    select: { id: true, name: true, type: true, phase: true, plan: true },
  });
  const plan = project ? ProjectPlan.safeParse(project.plan) : null;
  if (!project || !plan?.success) return null;
  const state = await projectGenerationState(maker.id, projectId);
  const cards: Record<string, CardLike> = {};
  for (const [id, card] of Object.entries(state.cards)) {
    const parsed = CardState.safeParse(card);
    if (parsed.success) cards[id] = parsed.data;
  }
  const { plan: _plan, ...summary } = project;
  return { project: summary, frames: frameViews(plan.data, cards, state.jobs) };
}

// The current maker's projects that have frames (started from New project),
// newest first: what `kiln projects` lists.
export async function framedProjects(): Promise<
  (ProjectFrames["project"] & { updatedAt: string })[]
> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
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

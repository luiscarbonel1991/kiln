import { Card } from "@/domain/card";
import {
  type FrameView,
  frameSlots,
  frameViews,
  waitingFrames,
} from "@/domain/frame-view";
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

// A project's plan, cards and jobs, as its frames are read from them. Null
// for a project the current maker does not have, or one with no plan (a
// studio project: it has no frames).
async function loadFrames(projectId: string) {
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
  return { project: summary, plan: plan.data, cards, jobs: state.jobs };
}

export async function projectFrames(
  projectId: string,
): Promise<ProjectFrames | null> {
  const loaded = await loadFrames(projectId);
  if (!loaded) return null;
  const { project, plan, cards, jobs } = loaded;
  return { project, frames: frameViews(plan, cards, jobs) };
}

// The scene frames a batch would generate now, as the board's Generate picks
// them; null as projectFrames.
export async function waitingProjectFrames(
  projectId: string,
): Promise<string[] | null> {
  const loaded = await loadFrames(projectId);
  if (!loaded) return null;
  return waitingFrames(frameSlots(loaded.plan, loaded.cards, loaded.jobs));
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

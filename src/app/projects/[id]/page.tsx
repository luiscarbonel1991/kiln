import Link from "next/link";
import { notFound } from "next/navigation";
import type { BatchEstimate } from "@/components/projects/generation-panel";
import {
  boardRows,
  ProjectBoard,
  waitingCardIds,
} from "@/components/projects/project-board";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { providerMode } from "@/providers/mode";
import { estimateProjectCards } from "@/server/generation-queue";
import { projectGenerationState } from "@/server/generation-repository";
import { getCurrentMaker, getMakerBrand } from "@/server/maker-repository";
import { loadProjectBoard } from "@/server/project-repository";

// The estimate of a batch of every waiting scene, built exactly as the queue
// would build it (null when there is nothing to generate or no reference yet).
async function batchEstimate(
  projectId: string,
  cardIds: string[],
): Promise<BatchEstimate | null> {
  if (cardIds.length === 0) return null;
  try {
    const { cards, model, quality } = await estimateProjectCards(
      projectId,
      cardIds,
    );
    return {
      count: cards.length,
      typicalMicros: cards.reduce((t, c) => t + c.typicalMicros, 0),
      maxMicros: cards.reduce((t, c) => t + c.maxMicros, 0),
      model,
      quality,
    };
  } catch {
    return null;
  }
}

// The Project board (ROADMAP screen 3): the storyboard of a planned project.
// Dynamic per request (no static params); a project of another maker or an
// unknown id is a 404.
export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadProjectBoard(id);
  if (!loaded) notFound();
  const { board, product } = loaded;
  const maker = await getCurrentMaker();
  const generation = await projectGenerationState(maker.id, board.id);
  const brand = await getMakerBrand();
  const plan = board.plan;
  const estimate =
    plan && board.master
      ? await batchEstimate(
          board.id,
          waitingCardIds(boardRows({ ...board, plan }, generation.jobs)),
        )
      : null;
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          project
        </span>
      </ProjectsHeader>
      {board.plan && product ? (
        <ProjectBoard
          projectId={board.id}
          board={{ ...board, plan: board.plan }}
          product={product}
          jobs={generation.jobs}
          generation={generation}
          estimate={estimate}
          mode={providerMode()}
          brand={brand}
        />
      ) : (
        <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
          <h1 className="font-serif text-2xl italic text-foreground">
            {board.name}
          </h1>
          <p className="font-sans text-sm text-on-surface-mid">
            This project was made in the studio; it has no plan to show.
          </p>
          <Link
            href={`/projects/${board.id}/editor`}
            className="font-sans text-sm font-semibold text-primary"
          >
            Open it in the editor
          </Link>
        </main>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectBoard } from "@/components/projects/project-board";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { loadProjectBoard } from "@/server/project-repository";

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

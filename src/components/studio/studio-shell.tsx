"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnalysisPhase } from "@/components/studio/analysis-phase";
import { GenerationPhase } from "@/components/studio/generation-phase";
import { PlanningPhase } from "@/components/studio/planning-phase";
import { ProjectGallery } from "@/components/studio/project-gallery";
import { StudioHeader } from "@/components/studio/studio-header";
import { UploadPhase } from "@/components/studio/upload-phase";
import type { MakerModels } from "@/domain/model-defaults";
import { NO_TAKE_ROUTES, type TakeRoutes } from "@/domain/model-routing";
import { useProject } from "@/store/project";
import { useGenerationSync } from "@/store/use-generation-sync";
import { useProjectPersistence } from "@/store/use-project-persistence";

// The studio. With `projectId` it is the advanced view of a planned project
// (opened from a board slot): bound to that project, never a fresh session.
export function StudioShell({
  fresh = false,
  projectId,
  openId,
  focusCardId,
  makerModels,
  takeRoutes = NO_TAKE_ROUTES,
}: {
  fresh?: boolean;
  projectId?: string;
  // A studio project opened from Home (else the latest is restored).
  openId?: string;
  focusCardId?: string;
  makerModels: MakerModels;
  // A planned project's routes: its cards' takes are priced along them.
  takeRoutes?: TakeRoutes;
}) {
  const setMakerModels = useProject((s) => s.setMakerModels);
  useEffect(() => setMakerModels(makerModels), [makerModels, setMakerModels]);
  const setTakeRoutes = useProject((s) => s.setTakeRoutes);
  useEffect(() => setTakeRoutes(takeRoutes), [takeRoutes, setTakeRoutes]);
  const phase = useProject((s) => s.phase);
  const master = useProject((s) => s.master);
  const loadedId = useProject((s) => s.projectId);
  const reset = useProject((s) => s.reset);
  const { status, missing } = useProjectPersistence({
    fresh,
    projectId,
    openId,
  });
  useGenerationSync(projectId, loadedId === projectId);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const boardHref = projectId ? `/projects/${projectId}` : undefined;

  return (
    <div className="flex min-h-full flex-col">
      <StudioHeader
        phase={phase}
        showStartOver={phase !== "upload"}
        onStartOver={reset}
        onOpenGallery={() => setGalleryOpen(true)}
        saveStatus={status}
        boardHref={boardHref}
      />
      {projectId ? (
        <ProjectEditor
          ready={loadedId === projectId}
          missing={missing}
          hasMaster={master !== null}
          boardHref={boardHref ?? "/"}
          focusCardId={focusCardId}
        />
      ) : phase === "upload" || master === null ? (
        <UploadPhase onViewAll={() => setGalleryOpen(true)} />
      ) : phase === "planning" ? (
        <PlanningPhase key={master.id} master={master} />
      ) : phase === "generation" ? (
        <GenerationPhase key={master.id} />
      ) : (
        <AnalysisPhase key={master.id} master={master} />
      )}
      {galleryOpen ? (
        <ProjectGallery onClose={() => setGalleryOpen(false)} />
      ) : null}
    </div>
  );
}

function ProjectEditor({
  ready,
  missing,
  hasMaster,
  boardHref,
  focusCardId,
}: {
  ready: boolean;
  missing: boolean;
  hasMaster: boolean;
  boardHref: string;
  focusCardId?: string;
}) {
  if (missing) {
    return (
      <Notice text="This project could not be found." href="/" link="Home" />
    );
  }
  if (!ready) {
    return (
      <p className="px-8 py-24 text-center font-mono text-[0.7rem] text-on-surface-dim">
        Loading the project…
      </p>
    );
  }
  if (!hasMaster) {
    return (
      <Notice
        text="Add a reference image on the board first: every scene edits it."
        href={boardHref}
        link="Back to the board"
      />
    );
  }
  return <GenerationPhase projectMode focusCardId={focusCardId} />;
}

function Notice({
  text,
  href,
  link,
}: {
  text: string;
  href: string;
  link: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <p className="font-sans text-sm text-on-surface-mid">{text}</p>
      <Link
        href={href}
        className="font-sans text-sm font-semibold text-primary"
      >
        {link}
      </Link>
    </div>
  );
}

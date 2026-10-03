"use client";

import { useState } from "react";
import { AnalysisPhase } from "@/components/studio/analysis-phase";
import { GenerationPhase } from "@/components/studio/generation-phase";
import { PlanningPhase } from "@/components/studio/planning-phase";
import { ProjectGallery } from "@/components/studio/project-gallery";
import { StudioHeader } from "@/components/studio/studio-header";
import { UploadPhase } from "@/components/studio/upload-phase";
import { useProject } from "@/store/project";
import { useProjectPersistence } from "@/store/use-project-persistence";

export function StudioShell({ fresh = false }: { fresh?: boolean }) {
  const phase = useProject((s) => s.phase);
  const master = useProject((s) => s.master);
  const reset = useProject((s) => s.reset);
  const { status } = useProjectPersistence({ fresh });
  const [galleryOpen, setGalleryOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col">
      <StudioHeader
        phase={phase}
        showStartOver={phase !== "upload"}
        onStartOver={reset}
        onOpenGallery={() => setGalleryOpen(true)}
        saveStatus={status}
      />
      {phase === "upload" || master === null ? (
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

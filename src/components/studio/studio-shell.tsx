"use client";

import { useState } from "react";
import { AnalysisPhase } from "@/components/studio/analysis-phase";
import { GenerationPhase } from "@/components/studio/generation-phase";
import { PlanningPhase } from "@/components/studio/planning-phase";
import { StudioHeader } from "@/components/studio/studio-header";
import { UploadPhase } from "@/components/studio/upload-phase";
import { WorkspaceGallery } from "@/components/studio/workspace-gallery";
import { useWorkspacePersistence } from "@/store/use-workspace-persistence";
import { useWorkspace } from "@/store/workspace";

export function StudioShell() {
  const phase = useWorkspace((s) => s.phase);
  const master = useWorkspace((s) => s.master);
  const reset = useWorkspace((s) => s.reset);
  const { status } = useWorkspacePersistence();
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
        <WorkspaceGallery onClose={() => setGalleryOpen(false)} />
      ) : null}
    </div>
  );
}

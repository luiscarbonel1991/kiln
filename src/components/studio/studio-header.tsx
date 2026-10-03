"use client";

import { ArrowLeft } from "lucide-react";
import { AutosaveStatus } from "@/components/studio/autosave-status";
import { PhaseIndicator } from "@/components/studio/phase-indicator";
import { ProjectsButton } from "@/components/studio/projects-button";
import { Button } from "@/components/ui/button";
import type { Phase } from "@/store/project";
import type { PersistenceStatus } from "@/store/use-project-persistence";

export function StudioHeader({
  phase,
  showStartOver,
  onStartOver,
  onOpenGallery,
  saveStatus,
}: {
  phase: Phase;
  showStartOver: boolean;
  onStartOver: () => void;
  onOpenGallery: () => void;
  saveStatus: PersistenceStatus;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border-soft bg-card/70 px-6 py-4 backdrop-blur-md sm:px-8">
      <div className="flex items-center gap-5">
        <div
          className="font-serif text-2xl italic leading-none text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          kiln<span className="text-primary">.</span>
        </div>
        {/* Quiet phase indicator — only once a project is active. */}
        {showStartOver ? <PhaseIndicator phase={phase} /> : null}
      </div>
      {/* The gallery is always available; autosave status + Start over only once a
          project is in progress. */}
      <div className="flex items-center gap-3">
        {showStartOver ? <AutosaveStatus status={saveStatus} /> : null}
        <ProjectsButton onOpen={onOpenGallery} />
        {showStartOver ? (
          <Button variant="ghost" size="sm" onClick={onStartOver}>
            <ArrowLeft /> Start over
          </Button>
        ) : null}
      </div>
    </header>
  );
}

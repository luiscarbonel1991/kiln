"use client";

import { ArrowLeft, LayoutGrid, Plus } from "lucide-react";
import Link from "next/link";
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
  boardHref,
}: {
  phase: Phase;
  showStartOver: boolean;
  onStartOver: () => void;
  onOpenGallery: () => void;
  saveStatus: PersistenceStatus;
  // Set when editing a planned project: the header leads back to its board
  // instead of offering the gallery and Start over.
  boardHref?: string;
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
        {showStartOver || boardHref ? (
          <AutosaveStatus status={saveStatus} />
        ) : null}
        {boardHref ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={boardHref}>
              <LayoutGrid /> Board
            </Link>
          </Button>
        ) : (
          <>
            <ProjectsButton onOpen={onOpenGallery} />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          </>
        )}
        {showStartOver && !boardHref ? (
          <Button variant="ghost" size="sm" onClick={onStartOver}>
            <ArrowLeft /> Start over
          </Button>
        ) : null}
      </div>
    </header>
  );
}

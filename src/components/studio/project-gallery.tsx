"use client";

import { Plus, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ProjectCard } from "@/components/studio/project-card";
import { Button } from "@/components/ui/button";
import { useProjectBrowser } from "@/store/use-project-browser";

// Full-screen gallery of saved projects (portaled to body, like the image
// lightbox). Click a card to open it (a planned project on its board, a studio
// project in place), "New project" for the New project flow, or the hover trash
// to delete. Esc / the dark margin / the X close it.
export function ProjectGallery({ onClose }: { onClose: () => void }) {
  const { projects, loading, busy, error, refresh, open, remove, rename } =
    useProjectBrowser();

  // Fetch the list only when the overlay mounts (lazy; the landing stays query-free).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Esc closes; lock body scroll while the overlay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const router = useRouter();
  const newProject = () => {
    onClose();
    router.push("/projects/new");
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Projects"
      data-testid="project-gallery"
      className="fixed inset-0 z-50 overflow-y-auto"
    >
      {/* Real button backdrop: keyboard-accessible, fixed so it stays put while the
          content scrolls, behind the relative content layer. */}
      <button
        type="button"
        aria-label="Close projects"
        data-testid="project-gallery-backdrop"
        onClick={() => {
          if (!busy) onClose();
        }}
        className="fixed inset-0 cursor-default bg-foreground/85 backdrop-blur-sm"
      />
      <div className="relative mx-auto w-full max-w-[1120px] p-6 sm:p-10">
        <div className="mb-6 flex items-center justify-between">
          <h2
            className="font-serif text-2xl text-card"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            Projects
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onClick={newProject}
              data-testid="project-gallery-new"
            >
              <Plus /> New project
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close projects"
              data-testid="project-gallery-close"
              className="flex size-9 items-center justify-center rounded-pill bg-card/90 text-foreground shadow-render transition-colors hover:bg-card"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {loading && projects.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-24 font-mono text-sm text-card/80">
            <RefreshCw className="size-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="font-sans text-sm text-card">
              Couldn't load projects.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              data-testid="project-gallery-retry"
            >
              Retry
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="font-serif text-lg text-card">
              No saved projects yet.
            </p>
            <p className="font-mono text-[0.6875rem] text-card/70">
              Start one and it'll show up here.
            </p>
            <Button
              variant="default"
              size="sm"
              onClick={newProject}
              data-testid="project-gallery-empty-new"
            >
              <Plus /> New project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 pb-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((w) => (
              <ProjectCard
                key={w.id}
                summary={w}
                disabled={busy}
                onOpen={() => {
                  if (w.planned) {
                    onClose();
                    router.push(`/projects/${w.id}`);
                  } else {
                    void open(w.id).then(onClose);
                  }
                }}
                onDelete={() => {
                  void remove(w.id);
                }}
                onRename={(name) => {
                  void rename(w.id, name);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { Plus, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { WorkspaceCard } from "@/components/studio/workspace-card";
import { Button } from "@/components/ui/button";
import { useWorkspaceBrowser } from "@/store/use-workspace-browser";

// Full-screen gallery of saved workspaces (portaled to body, like the image
// lightbox). Click a card to open/resume it, "New workspace" to start fresh, or
// the hover trash to delete. Esc / the dark margin / the X close it.
export function WorkspaceGallery({ onClose }: { onClose: () => void }) {
  const {
    workspaces,
    loading,
    busy,
    error,
    refresh,
    open,
    startNew,
    remove,
    rename,
  } = useWorkspaceBrowser();

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

  const newWorkspace = () => {
    void startNew().then(onClose);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Real button backdrop: keyboard-accessible, fixed so it stays put while the
          content scrolls, behind the relative content layer. */}
      <button
        type="button"
        aria-label="Close workspaces"
        onClick={() => {
          if (!busy) onClose();
        }}
        className="fixed inset-0 cursor-default bg-foreground/85 backdrop-blur-sm"
      />
      <div className="relative mx-auto w-full max-w-[1120px] p-6 sm:p-10">
        <div className="mb-6 flex items-center justify-between">
          <h2
            className="font-serif text-2xl italic text-card"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            Workspaces
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onClick={newWorkspace}
            >
              <Plus /> New workspace
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close workspaces"
              className="flex size-9 items-center justify-center rounded-pill bg-card/90 text-foreground shadow-render transition-colors hover:bg-card"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {loading && workspaces.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-24 font-mono text-sm text-card/80">
            <RefreshCw className="size-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="font-sans text-sm text-card">
              Couldn't load workspaces.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="font-serif text-lg italic text-card">
              No saved workspaces yet.
            </p>
            <p className="font-mono text-[0.6875rem] text-card/70">
              Start one and it'll show up here.
            </p>
            <Button variant="default" size="sm" onClick={newWorkspace}>
              <Plus /> New workspace
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 pb-6 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <WorkspaceCard
                key={w.id}
                summary={w}
                disabled={busy}
                onOpen={() => {
                  void open(w.id).then(onClose);
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

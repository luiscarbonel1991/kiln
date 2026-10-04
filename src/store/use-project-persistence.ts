"use client";

import { useEffect, useRef, useState } from "react";
import {
  listProjectsAction,
  loadProjectAction,
  saveProjectAction,
} from "@/app/actions/project";
import { createDebouncedTask } from "@/lib/debounce";
import { shouldAutosave, toPersisted, useProject } from "@/store/project";

export type PersistenceStatus = "idle" | "restoring" | "saving" | "saved";

const AUTOSAVE_DEBOUNCE_MS = 1000;

// Autosave + restore-latest (Pillar C). Restores the most-recent project once on
// mount (only from a fresh store, so it never clobbers an in-progress session),
// then debounced-saves every change to that project. Imports only the project
// Server Actions — never the repository/db/SDK — so the client boundary stays clean.
export function useProjectPersistence({
  fresh = false,
  projectId,
}: {
  fresh?: boolean;
  // Bound to one project (the editor of a planned project's slot).
  projectId?: string;
} = {}): { status: PersistenceStatus; missing: boolean } {
  const [status, setStatus] = useState<PersistenceStatus>("idle");
  const [missing, setMissing] = useState(false);
  const restored = useRef(false);

  // Project mode: make sure the store holds this project. Not ref-guarded, so a
  // StrictMode remount (which resets the store on cleanup) simply loads again.
  // A project that cannot be loaded is reported, never replaced by a fresh
  // studio session (which would create another project under this URL).
  useEffect(() => {
    if (!projectId) return;
    if (useProject.getState().projectId === projectId) return;
    let active = true;
    useProject.getState().reset();
    setStatus("restoring");
    loadProjectAction(projectId)
      .then((record) => {
        if (!active) return;
        if (record) useProject.getState().hydrate(record);
        else setMissing(true);
        setStatus("idle");
      })
      .catch(() => {
        if (!active) return;
        setMissing(true);
        setStatus("idle");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  // Restore the latest saved project once, only when the store is fresh.
  useEffect(() => {
    if (projectId || restored.current) return;
    restored.current = true;
    // A fresh start: whatever the store still holds was saved when its page
    // unmounted; begin empty and restore nothing.
    if (fresh) {
      useProject.getState().reset();
      return;
    }
    const state = useProject.getState();
    if (state.phase !== "upload" || state.master || state.projectId) return;

    let active = true;
    setStatus("restoring");
    listProjectsAction()
      .then(async (rows) => {
        // Planned projects open on their board, not in the studio.
        const latest = rows.find((row) => !row.planned);
        if (active && latest) {
          const record = await loadProjectAction(latest.id);
          if (active && record) useProject.getState().hydrate(record);
        }
        if (active) setStatus("idle");
      })
      .catch(() => {
        if (active) setStatus("idle");
      });
    return () => {
      active = false;
    };
  }, [fresh, projectId]);

  // Debounced autosave on any store change, once there is a master to persist.
  // On unmount a pending save is flushed, not dropped, so leaving the editor
  // right after an edit (or a generation result) still persists it.
  useEffect(() => {
    let active = true;

    const save = async () => {
      const state = useProject.getState();
      if (!state.master) return;
      if (active) setStatus("saving");
      try {
        const { id } = await saveProjectAction(
          toPersisted(state),
          state.projectId ?? undefined,
        );
        // Adopt the new id only if the store still holds the project just saved
        // (it may have been reset or switched while the save was in flight).
        const now = useProject.getState();
        if (!now.projectId && now.master?.id === state.master.id) {
          now.setProjectId(id);
        }
        if (active) setStatus("saved");
      } catch {
        if (active) setStatus("idle");
      }
    };

    const autosave = createDebouncedTask(() => {
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
    const unsubscribe = useProject.subscribe((state, prev) => {
      if (shouldAutosave(state, prev)) autosave.schedule();
    });
    return () => {
      active = false;
      unsubscribe();
      autosave.flush();
      // Leaving a bound project: its pending save has just been taken; start
      // the next page from an empty store, so "/" never shows a planned project.
      if (projectId) useProject.getState().reset();
    };
  }, [projectId]);

  return { status, missing };
}

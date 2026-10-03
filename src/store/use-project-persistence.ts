"use client";

import { useEffect, useRef, useState } from "react";
import {
  listProjectsAction,
  loadProjectAction,
  saveProjectAction,
} from "@/app/actions/project";
import { createDebouncedTask } from "@/lib/debounce";
import { toPersisted, useProject } from "@/store/project";

export type PersistenceStatus = "idle" | "restoring" | "saving" | "saved";

const AUTOSAVE_DEBOUNCE_MS = 1000;

// Autosave + restore-latest (Pillar C). Restores the most-recent project once on
// mount (only from a fresh store, so it never clobbers an in-progress session),
// then debounced-saves every change to that project. Imports only the project
// Server Actions — never the repository/db/SDK — so the client boundary stays clean.
export function useProjectPersistence(): { status: PersistenceStatus } {
  const [status, setStatus] = useState<PersistenceStatus>("idle");
  const restored = useRef(false);

  // Restore the latest saved project once, only when the store is fresh.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const state = useProject.getState();
    if (state.phase !== "upload" || state.master || state.projectId) return;

    let active = true;
    setStatus("restoring");
    listProjectsAction()
      .then(async (rows) => {
        if (active && rows.length > 0) {
          const record = await loadProjectAction(rows[0].id);
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
  }, []);

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
    const unsubscribe = useProject.subscribe(autosave.schedule);
    return () => {
      active = false;
      unsubscribe();
      autosave.flush();
    };
  }, []);

  return { status };
}

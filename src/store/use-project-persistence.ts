"use client";

import { useEffect, useRef, useState } from "react";
import {
  listProjectsAction,
  loadProjectAction,
  saveProjectAction,
} from "@/app/actions/project";
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
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const state = useProject.getState();
        if (!state.master) return;
        setStatus("saving");
        try {
          const { id } = await saveProjectAction(
            toPersisted(state),
            state.projectId ?? undefined,
          );
          if (!active) return;
          if (!useProject.getState().projectId) {
            useProject.getState().setProjectId(id);
          }
          setStatus("saved");
        } catch {
          if (active) setStatus("idle");
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    };

    const unsubscribe = useProject.subscribe(schedule);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return { status };
}

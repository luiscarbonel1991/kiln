"use client";

import { useEffect, useRef, useState } from "react";
import {
  listProjectsAction,
  loadProjectAction,
  saveProjectAction,
} from "@/app/actions/project";
import { toPersisted, useWorkspace } from "@/store/workspace";

export type PersistenceStatus = "idle" | "restoring" | "saving" | "saved";

const AUTOSAVE_DEBOUNCE_MS = 1000;

// Autosave + restore-latest (Pillar C). Restores the most-recent workspace once on
// mount (only from a fresh store, so it never clobbers an in-progress session),
// then debounced-saves every change to that workspace. Imports only the workspace
// Server Actions — never the repository/db/SDK — so the client boundary stays clean.
export function useWorkspacePersistence(): { status: PersistenceStatus } {
  const [status, setStatus] = useState<PersistenceStatus>("idle");
  const restored = useRef(false);

  // Restore the latest saved workspace once, only when the store is fresh.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const state = useWorkspace.getState();
    if (state.phase !== "upload" || state.master || state.workspaceId) return;

    let active = true;
    setStatus("restoring");
    listProjectsAction()
      .then(async (rows) => {
        if (active && rows.length > 0) {
          const record = await loadProjectAction(rows[0].id);
          if (active && record) useWorkspace.getState().hydrate(record);
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
        const state = useWorkspace.getState();
        if (!state.master) return;
        setStatus("saving");
        try {
          const { id } = await saveProjectAction(
            toPersisted(state),
            state.workspaceId ?? undefined,
          );
          if (!active) return;
          if (!useWorkspace.getState().workspaceId) {
            useWorkspace.getState().setWorkspaceId(id);
          }
          setStatus("saved");
        } catch {
          if (active) setStatus("idle");
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    };

    const unsubscribe = useWorkspace.subscribe(schedule);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return { status };
}

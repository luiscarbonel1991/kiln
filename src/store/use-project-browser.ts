"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteProjectAction,
  listProjectsAction,
  loadProjectAction,
  renameProjectAction,
  saveProjectAction,
} from "@/app/actions/project";
import type { ProjectSummary } from "@/domain/persisted-project";
import { toPersisted, useProject } from "@/store/project";

export interface ProjectBrowser {
  projects: ProjectSummary[];
  loading: boolean;
  busy: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
}

// Flush the CURRENT project before navigating away. Autosave is debounced 1s,
// so an edit made just before switching would otherwise be lost: its pending save
// would fire AFTER we hydrate the next project and write to the wrong id. This
// is best-effort — a failed save must not trap the user on the current project
// (the debounced autosave is the fallback).
async function flushCurrent(): Promise<void> {
  const s = useProject.getState();
  if (s.master && s.projectId) {
    try {
      await saveProjectAction(toPersisted(s), s.projectId);
    } catch {
      // swallow — navigation must proceed
    }
  }
}

// The project gallery's data + navigation hook — a sibling to
// useProjectPersistence (the autosave/restore engine). They cooperate through
// the shared Zustand store; this hook owns the list and the open/new/delete
// flows. Imports only Server Actions + the store — never the repository/db/SDK.
export function useProjectBrowser(): ProjectBrowser {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const rows = await listProjectsAction();
      if (active.current) setProjects(rows);
    } catch {
      if (active.current) setError(true);
    } finally {
      if (active.current) setLoading(false);
    }
  }, []);

  const open = useCallback(async (id: string) => {
    if (useProject.getState().projectId === id) return; // already open
    setBusy(true);
    try {
      await flushCurrent();
      const record = await loadProjectAction(id);
      if (record) useProject.getState().hydrate(record);
    } finally {
      if (active.current) setBusy(false);
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await deleteProjectAction(id);
        if (useProject.getState().projectId === id) {
          useProject.getState().reset();
        }
        await refresh();
      } finally {
        if (active.current) setBusy(false);
      }
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      setBusy(true);
      try {
        // DB-only: the project name lives in the row, not the store, and autosave
        // no longer writes it — so this sticks whether or not it is the open one.
        await renameProjectAction(id, name);
        await refresh();
      } finally {
        if (active.current) setBusy(false);
      }
    },
    [refresh],
  );

  return {
    projects,
    loading,
    busy,
    error,
    refresh,
    open,
    remove,
    rename,
  };
}

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
import { toPersisted, useWorkspace } from "@/store/workspace";

export interface WorkspaceBrowser {
  workspaces: ProjectSummary[];
  loading: boolean;
  busy: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  startNew: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
}

// Flush the CURRENT workspace before navigating away. Autosave is debounced 1s,
// so an edit made just before switching would otherwise be lost: its pending save
// would fire AFTER we hydrate the next workspace and write to the wrong id. This
// is best-effort — a failed save must not trap the user on the current workspace
// (the debounced autosave is the fallback).
async function flushCurrent(): Promise<void> {
  const s = useWorkspace.getState();
  if (s.master && s.workspaceId) {
    try {
      await saveProjectAction(toPersisted(s), s.workspaceId);
    } catch {
      // swallow — navigation must proceed
    }
  }
}

// The workspace gallery's data + navigation hook — a sibling to
// useWorkspacePersistence (the autosave/restore engine). They cooperate through
// the shared Zustand store; this hook owns the list and the open/new/delete
// flows. Imports only Server Actions + the store — never the repository/db/SDK.
export function useWorkspaceBrowser(): WorkspaceBrowser {
  const [workspaces, setWorkspaces] = useState<ProjectSummary[]>([]);
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
      if (active.current) setWorkspaces(rows);
    } catch {
      if (active.current) setError(true);
    } finally {
      if (active.current) setLoading(false);
    }
  }, []);

  const open = useCallback(async (id: string) => {
    if (useWorkspace.getState().workspaceId === id) return; // already open
    setBusy(true);
    try {
      await flushCurrent();
      const record = await loadProjectAction(id);
      if (record) useWorkspace.getState().hydrate(record);
    } finally {
      if (active.current) setBusy(false);
    }
  }, []);

  const startNew = useCallback(async () => {
    setBusy(true);
    try {
      await flushCurrent();
      useWorkspace.getState().reset();
    } finally {
      if (active.current) setBusy(false);
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await deleteProjectAction(id);
        if (useWorkspace.getState().workspaceId === id) {
          useWorkspace.getState().reset();
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
        // DB-only: the workspace name lives in the row, not the store, and autosave
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
    workspaces,
    loading,
    busy,
    error,
    refresh,
    open,
    startNew,
    remove,
    rename,
  };
}

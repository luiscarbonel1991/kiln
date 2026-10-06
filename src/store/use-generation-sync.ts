"use client";

import { useEffect } from "react";
import { isActiveJob } from "@/domain/queue";
import { type ServerGenerationState, useProject } from "@/store/project";

const ACTIVE_MS = 2500;
const IDLE_MS = 10_000;
// A hidden tab keeps polling, slower, and catches up at once when it is back.
const HIDDEN_MS = 15_000;

// Keeps a planned project's editor in step with the queue: polls the project's
// generation state (the same GET Route Handler the board uses, outside the
// serial Server Action queue) — often while a job runs, slowly otherwise or
// while the tab is hidden, so a batch started on the board shows up too — and
// merges it into the store. One request at a time. A response that started
// before the editor's latest enqueue is dropped, so it cannot undo the
// optimistic "queued".
export function useGenerationSync(
  projectId: string | undefined,
  enabled: boolean,
) {
  useEffect(() => {
    if (!projectId || !enabled) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      const started = Date.now();
      try {
        const res = await fetch(`/api/projects/${projectId}/generation`, {
          cache: "no-store",
        });
        const state = (await res.json()) as ServerGenerationState;
        const store = useProject.getState();
        if (
          !stopped &&
          store.projectId === projectId &&
          started >= store.lastEnqueueAt
        ) {
          store.mergeGenerationState(state);
        }
      } catch {
        // a missed poll is retried on the next tick
      } finally {
        inFlight = false;
      }
      if (stopped) return;
      const active = Object.values(useProject.getState().jobs).some(
        isActiveJob,
      );
      timer = setTimeout(
        tick,
        document.hidden ? HIDDEN_MS : active ? ACTIVE_MS : IDLE_MS,
      );
    };
    const wake = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [projectId, enabled]);
}

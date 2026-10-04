"use client";

import { useEffect } from "react";
import { isActiveJob } from "@/domain/queue";
import { type ServerGenerationState, useProject } from "@/store/project";

const ACTIVE_MS = 2500;
const IDLE_MS = 10_000;

// Keeps a planned project's editor in step with the queue: polls the project's
// generation state (the same GET Route Handler the board uses, outside the
// serial Server Action queue) — often while a job runs, slowly otherwise, so a
// batch started on the board shows up too — and merges it into the store. A
// response that started before the editor's latest enqueue is dropped, so it
// cannot undo the optimistic "queued".
export function useGenerationSync(
  projectId: string | undefined,
  enabled: boolean,
) {
  useEffect(() => {
    if (!projectId || !enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      const started = Date.now();
      if (!document.hidden) {
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
        }
      }
      if (stopped) return;
      const active = Object.values(useProject.getState().jobs).some(
        isActiveJob,
      );
      timer = setTimeout(tick, active ? ACTIVE_MS : IDLE_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId, enabled]);
}

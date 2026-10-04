"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 3000;

// While generations run, poll the project's generation state (a GET Route
// Handler, outside the serial Server Action queue) and re-render the page only
// when its version changes. Chained timeouts (never stacked), paused while the
// tab is hidden, stopped when nothing is running.
export function GenerationPoller({
  projectId,
  version,
  active,
}: {
  projectId: string;
  version: string;
  active: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const res = await fetch(`/api/projects/${projectId}/generation`, {
            cache: "no-store",
          });
          const state = (await res.json()) as { version: string };
          if (state.version !== version) {
            router.refresh();
            return;
          }
        } catch {
          // a missed poll is retried on the next tick
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId, version, active, router]);
  return null;
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 3000;
// A hidden tab keeps polling, slower: a batch left running in a background
// tab (or one a browser automation drives) must still land on the board.
const HIDDEN_POLL_MS = 15_000;
// A refresh that has not brought the new version after this long is retried.
const REFRESH_GRACE_MS = 10_000;

// While generations run, poll the project's generation state (a GET Route
// Handler, outside the serial Server Action queue) and re-render the page when
// its version changes. Chained timeouts (never stacked, one request at a
// time), slower while the tab is hidden, at once when it comes back, and
// stopped when nothing is running. The chain survives a refresh that does not
// land: it keeps polling and refreshes again after a grace period.
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
    let inFlight = false;
    let refreshedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      try {
        const res = await fetch(`/api/projects/${projectId}/generation`, {
          cache: "no-store",
        });
        const state = (await res.json()) as { version: string };
        if (
          !stopped &&
          state.version !== version &&
          Date.now() - refreshedAt > REFRESH_GRACE_MS
        ) {
          refreshedAt = Date.now();
          router.refresh();
        }
      } catch {
        // a missed poll is retried on the next tick
      } finally {
        inFlight = false;
      }
      if (!stopped) {
        timer = setTimeout(tick, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
      }
    };
    const wake = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [projectId, version, active, router]);
  return null;
}

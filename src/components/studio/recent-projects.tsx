"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ProjectCard } from "@/components/studio/project-card";
import { useProjectBrowser } from "@/store/use-project-browser";

const MAX_RECENT = 4;

// Shown on the landing once there are saved projects — quick-resume the latest
// few without opening the full gallery (the header "Projects" button shows all).
// Reuses the same browser hook + card, so open/delete/rename behave identically.
// `onViewAll` opens the full gallery; the count becomes that affordance when there
// are more saved than the preview shows (so "N saved" never sits next to fewer cards).
export function RecentProjects({ onViewAll }: { onViewAll?: () => void }) {
  const { projects, busy, refresh, open, remove, rename } = useProjectBrowser();
  const router = useRouter();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Render nothing until there's something to show — keeps the landing clean on a
  // fresh/empty database and avoids a layout flash while the list loads.
  if (projects.length === 0) return null;

  const recent = projects.slice(0, MAX_RECENT);
  const hasMore = projects.length > recent.length;

  return (
    <section className="mx-auto max-w-[1120px] px-6 pb-16 sm:px-8">
      <div className="mb-5 flex items-baseline justify-between border-border-soft border-t pt-8">
        <h2 className="font-serif text-xl text-foreground">
          Pick up where you left off
        </h2>
        {hasMore && onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            data-testid="recent-projects-view-all"
            className="rounded-pill font-mono text-[0.6875rem] text-on-surface-mid transition-colors hover:text-foreground"
          >
            View all {projects.length} →
          </button>
        ) : (
          <span className="font-mono text-[0.6875rem] text-on-surface-dim">
            {projects.length} saved
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {recent.map((w) => (
          <ProjectCard
            key={w.id}
            summary={w}
            disabled={busy}
            onOpen={() => {
              if (w.planned) router.push(`/projects/${w.id}`);
              else void open(w.id);
            }}
            onDelete={() => {
              void remove(w.id);
            }}
            onRename={(name) => {
              void rename(w.id, name);
            }}
          />
        ))}
      </div>
    </section>
  );
}

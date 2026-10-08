"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteProjectAction,
  renameProjectAction,
} from "@/app/actions/project";
import { ProjectCard } from "@/components/studio/project-card";
import type { ProjectSummary } from "@/domain/persisted-project";

// Home's projects: a planned project opens on its board, a studio project in
// the studio; rename and delete in place.
export function HomeProjects({
  projects,
  details,
}: {
  projects: ProjectSummary[];
  details: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard
          key={p.id}
          summary={p}
          disabled={busy}
          detail={details[p.id]}
          onOpen={() =>
            router.push(
              p.planned
                ? `/projects/${p.id}`
                : `/studio?open=${encodeURIComponent(p.id)}`,
            )
          }
          onDelete={() => run(() => deleteProjectAction(p.id))}
          onRename={(name) => run(() => renameProjectAction(p.id, name))}
        />
      ))}
    </div>
  );
}

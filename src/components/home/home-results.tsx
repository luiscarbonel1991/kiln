import Link from "next/link";
import { READ_LABELS } from "@/domain/listing-results";
import { dayLabel } from "@/lib/results-view";
import type { FollowedListing } from "@/server/listing-results";

const LABEL =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";

// Home's results (ROADMAP Phase 20): every listing the maker follows, the
// reads due first (the reminder), then before against after where both were
// read, with the frames that changed and their family, so the scene styles
// that move a number add up per family.
export function HomeResults({ listings }: { listings: FollowedListing[] }) {
  const order = (l: FollowedListing) =>
    l.view.reads.find((r) => r.due)?.dueOn ?? l.view.next?.dueOn ?? "9999";
  const sorted = [...listings].sort((a, b) => order(a).localeCompare(order(b)));
  return (
    <div className="flex flex-col gap-3">
      {sorted.map(({ view, ...l }) => {
        const due = view.reads.filter((r) => r.due);
        return (
          <Link
            key={`${l.projectId}-${l.destinationId}`}
            href={`/projects/${l.projectId}#results-${l.destinationId}`}
            data-testid={`home-results-${l.projectId}-${l.destinationId}`}
            className="flex flex-col gap-2 rounded-card bg-card p-5 shadow-card transition-colors hover:bg-surface-soft sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>
                {l.destinationName}
                {l.family ? ` · ${l.family}` : ""}
              </span>
              <span className="font-serif text-lg italic leading-tight text-foreground">
                {l.projectName}
              </span>
              {view.comparison?.line ? (
                <span className="font-sans text-[0.8rem] text-foreground">
                  {view.comparison.line}
                  <span className="text-on-surface-mid">
                    {" "}
                    ({READ_LABELS[view.comparison.against].toLowerCase()})
                  </span>
                </span>
              ) : null}
              {view.comparison?.thin ? (
                <span className="font-sans text-[0.75rem] text-on-surface-mid">
                  Few visits so far: a change this size can be chance.
                </span>
              ) : null}
              {view.changed.length > 0 ? (
                <span className="font-sans text-[0.75rem] text-on-surface-mid">
                  Changed: {view.changed.map((f) => f.label).join(", ")}
                </span>
              ) : null}
            </div>
            <div className="flex flex-shrink-0 flex-col gap-1 font-mono text-[0.68rem] sm:items-end">
              {due.map((r) => (
                <span key={r.key} className="text-prov-local">
                  {r.label} read due
                </span>
              ))}
              {view.next ? (
                <span className="text-on-surface-mid">
                  {READ_LABELS[view.next.key]}: {dayLabel(view.next.dueOn)}
                </span>
              ) : null}
              <span className="text-on-surface-dim">
                Photos up {dayLabel(view.liveOn)}
              </span>
              {due.length === 0 && !view.next ? (
                <span className="text-prov-recipe">All three read</span>
              ) : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

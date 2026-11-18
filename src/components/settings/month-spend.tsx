import { PersonMark } from "@/components/settings/person-mark";
import { microsMoney as money } from "@/lib/micros-money";
import type { MonthSpendLine } from "@/server/team";

// Settings → This month, per person: a mark, a name that truncates, and the
// amount on the right that never wraps; one line each, on a phone too.
export function MonthSpend({ lines }: { lines: MonthSpendLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <ul
        className="flex flex-col divide-y divide-border-soft"
        data-testid="month-spend"
      >
        {lines.map((line) => (
          <li
            key={line.memberId ?? "none"}
            className="flex items-center gap-3 py-2.5"
            data-testid="month-spend-line"
            data-who={line.who}
          >
            <PersonMark
              name={line.markName ?? "?"}
              faded={line.markName === null}
            />
            <span className="min-w-0 flex-1 truncate font-sans text-[0.9rem] text-foreground">
              {line.name}
              {line.you && line.who === "person" ? (
                <span className="text-on-surface-mid"> · you</span>
              ) : null}
            </span>
            <span className="shrink-0 font-mono text-[0.8rem] tabular-nums text-foreground">
              {money(line.spentMicros)}
            </span>
          </li>
        ))}
      </ul>
      {lines.some((line) => line.who === "none") ? (
        <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
          Access tokens, scripts, and work from before Kiln recorded who started
          it.
        </p>
      ) : null}
    </div>
  );
}

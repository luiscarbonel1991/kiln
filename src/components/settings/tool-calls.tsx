import { fromMicros } from "@/domain/generation-cost";
import type { ToolCallView } from "@/server/tool-calls";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Cents, or a tenth of a cent under one (a text call is $0.004).
const money = (micros: number) =>
  `$${fromMicros(micros).toFixed(micros > 0 && micros < 10_000 ? 3 : 2)}`;

// Settings → Access tokens: the latest tool calls agents made with the
// maker's tokens (MCP, `kiln call`), newest first, each with how it ended and,
// for a paid one, what its quote said at most.
export function ToolCalls({ calls }: { calls: ToolCallView[] }) {
  if (calls.length === 0) {
    return (
      <p
        className="font-sans text-[0.8rem] text-on-surface-mid"
        data-testid="tool-calls-empty"
      >
        No tool calls yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col" data-testid="tool-calls">
      {calls.map((c) => (
        <li
          key={c.id}
          data-testid={`tool-call-${c.id}`}
          data-ok={c.ok}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border-soft py-2 last:border-b-0"
        >
          <span className="font-mono text-[0.7rem] text-on-surface-dim">
            {when(c.at)}
          </span>
          <span className="font-mono text-[0.75rem] font-semibold text-foreground">
            {c.tool}
          </span>
          <span className="font-sans text-[0.75rem] text-on-surface-mid">
            {c.tokenName}
          </span>
          {c.quotedMaxMicros !== null ? (
            <span className="font-sans text-[0.75rem] text-on-surface-mid">
              quoted at most {money(c.quotedMaxMicros)}
            </span>
          ) : null}
          <span
            className={
              c.ok
                ? "font-sans text-[0.75rem] text-prov-recipe"
                : "min-w-0 basis-full font-sans text-[0.75rem] text-prov-local sm:basis-auto"
            }
          >
            {c.ok ? "done" : `refused: ${c.error ?? "no reason given"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

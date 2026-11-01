import type { KilnMessage } from "@/server/chat/messages";
import type { SessionSpend } from "@/server/generation-repository";

export function money(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "no pinned price";
  if (usd === 0) return "$0";
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

// What the conversation's replies cost in text: the sum of what each one
// says under it.
export function textMicros(messages: KilnMessage[]): number {
  return messages.reduce(
    (total, m) =>
      m.role === "assistant" ? total + (m.metadata?.costMicros ?? 0) : total,
    0,
  );
}

// What a conversation has spent so far, beside what the next turn may cost:
// its text and the work its paid tools ran, and what that work still holds
// while it runs. `runs` is null in a mock run, where nothing is paid.
export function spentLine(
  text: number,
  runs: SessionSpend | null,
): { line: string; detail: string } {
  if (runs === null) {
    return {
      line: "mock run · nothing is paid",
      detail: "A mock run: no model is called and nothing is paid.",
    };
  }
  const usd = (micros: number) => money(micros / 1_000_000);
  const queued =
    runs.queuedMicros > 0 ? ` · ${usd(runs.queuedMicros)} queued` : "";
  const total = text + runs.spentMicros;
  return {
    line:
      total === 0 && queued === ""
        ? "nothing spent here yet"
        : `spent here ${usd(total)}${queued}`,
    detail: `This conversation: text ${usd(text)} · work it ran ${usd(runs.spentMicros)}${queued}.`,
  };
}

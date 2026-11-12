"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { wordingHint } from "@/lib/product-checks";
import { cn } from "@/lib/utils";

// What the buyer personalizes, one line per row with its columns named: what
// the buyer is asked, an example (what the frames show), the most characters
// it takes, and whether the buyer may leave it out.

export interface WordingRow {
  label: string;
  example: string;
  maxChars: string;
  optional: boolean;
}

export const emptyWordingRow = (): WordingRow => ({
  label: "",
  example: "",
  maxChars: "",
  optional: false,
});

const HEAD =
  "font-sans text-[0.625rem] font-semibold text-on-surface-mid leading-tight";
// On a phone a line takes two rows: what the buyer writes beside the example,
// then Max, Optional and Remove under them.
const GRID =
  "grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4rem_5.5rem_2rem]";

export function WordingRows({
  rows,
  field,
  onChange,
  problems = {},
  notes,
  max = 3,
}: {
  rows: WordingRow[];
  // The input class the form uses.
  field: string;
  onChange: (rows: WordingRow[]) => void;
  // The form's problems by field ("wording.0.label"), once Save was tried.
  problems?: Record<string, string>;
  // The review's note for a field, if any ("wording.0.example").
  notes?: (field: string) => ReactNode;
  max?: number;
}) {
  const set = (i: number, patch: Partial<WordingRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.length > 0 ? (
        <div className={GRID} aria-hidden="true">
          <span className={HEAD}>What the buyer writes</span>
          <span className={HEAD}>Example</span>
          <div className="hidden sm:contents">
            <span className={HEAD}>Max</span>
            <span className={HEAD}>Optional</span>
            <span />
          </div>
        </div>
      ) : null}
      {rows.map((row, i) => {
        const hint = wordingHint(row);
        const problem =
          problems[`wording.${i}.label`] ?? problems[`wording.${i}.example`];
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
            key={i}
            className="flex flex-col gap-1"
          >
            <div className={GRID}>
              <input
                aria-label={`Line ${i + 1}: what the buyer writes`}
                data-field={`wording.${i}.label`}
                data-testid={`wording-${i + 1}-label`}
                className={field}
                value={row.label}
                placeholder="Name"
                onChange={(e) => set(i, { label: e.target.value })}
              />
              <input
                aria-label={`Line ${i + 1}: example`}
                data-field={`wording.${i}.example`}
                data-testid={`wording-${i + 1}-example`}
                className={field}
                value={row.example}
                placeholder="Sofia"
                onChange={(e) => set(i, { example: e.target.value })}
              />
              <div className="col-span-2 flex items-center gap-2 sm:contents">
                <span className={cn(HEAD, "sm:hidden")} aria-hidden="true">
                  Max
                </span>
                <input
                  aria-label={`Line ${i + 1}: most characters`}
                  data-field={`wording.${i}.maxChars`}
                  data-testid={`wording-${i + 1}-max`}
                  className={cn(field, "w-16 px-2")}
                  inputMode="numeric"
                  value={row.maxChars}
                  placeholder="—"
                  onChange={(e) =>
                    set(i, { maxChars: e.target.value.replace(/[^0-9]/g, "") })
                  }
                />
                <button
                  type="button"
                  aria-pressed={row.optional}
                  aria-label={`Line ${i + 1}: the buyer may leave it out`}
                  data-testid={`wording-${i + 1}-optional`}
                  onClick={() => set(i, { optional: !row.optional })}
                  className={cn(
                    "inline-flex h-9 w-22 items-center justify-center gap-1 rounded-field px-2 font-sans text-[0.75rem] transition-colors",
                    row.optional
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-on-surface-mid hover:bg-surface-soft",
                  )}
                >
                  {row.optional ? <Check className="size-3" /> : null}
                  {row.optional ? "Optional" : "Required"}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove line ${i + 1}`}
                  data-testid={`wording-${i + 1}-remove`}
                  className="ml-auto sm:ml-0"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            {problem ? (
              <span className="font-sans text-[0.75rem] text-fail">
                {problem}
              </span>
            ) : null}
            {hint ? (
              <span className="flex flex-wrap items-center gap-2 font-sans text-[0.75rem] text-fail">
                {hint.words}
                {hint.swap ? (
                  <button
                    type="button"
                    data-testid={`wording-${i + 1}-swap`}
                    onClick={() => set(i, { label: "", example: hint.swap })}
                    className="rounded-pill border border-border-soft bg-secondary px-2.5 py-0.5 text-xs text-on-surface-mid transition-colors hover:border-primary"
                  >
                    Use “{hint.swap}” as the example
                  </button>
                ) : null}
              </span>
            ) : null}
            {notes?.(`wording.${i}.label`)}
            {notes?.(`wording.${i}.example`)}
            {notes?.(`wording.${i}.maxChars`)}
          </div>
        );
      })}
      {rows.length < max ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          data-testid="wording-add"
          onClick={() => onChange([...rows, emptyWordingRow()])}
        >
          <Plus /> {rows.length === 0 ? "Add a line (optional)" : "Add a line"}
        </Button>
      ) : null}
      {rows.length > 0 ? (
        <span className="font-sans text-[0.75rem] text-on-surface-mid">
          The example is what the frames show. Leave Max empty when the text is
          fitted to the piece.
        </span>
      ) : null}
    </div>
  );
}

"use client";

import { FileUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MaterialCombobox } from "@/components/projects/material-combobox";
import { Button } from "@/components/ui/button";
import {
  columnsFit,
  guessColumns,
  parseTable,
  SearchColumn,
  type SearchColumns,
  searchesFromTable,
  type TargetSearch,
} from "@/domain/market-brief";

const LABEL =
  "font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const FIELD =
  "w-full min-w-0 rounded-field border border-border bg-secondary px-3 py-2 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";
const NOTE = "font-sans text-[0.75rem] leading-snug text-on-surface-mid";

const COLUMN_LABEL: Record<SearchColumn, string> = {
  term: "Term",
  searches: "Searches / mo",
  results: "Results",
  conversion: "Conversion",
  price: "Median price",
};

const DEFAULT_SOURCES = ["Etsy Marketplace Insights", "EverBee", "eRank"];
const MAX_FILE_BYTES = 1024 * 1024;

// A table of searches brought into the brief: pasted from the maker's notes
// or a spreadsheet, or a CSV their research tool exported, read in the
// browser (nothing is uploaded). Kiln guesses which column is which, or uses
// the mapping saved for that source; the maker checks it, names the source
// and the date the numbers were read, and adds the rows.
export function SearchTableImport({
  sources,
  today,
  testId,
  onAdd,
  onCancel,
}: {
  sources: Record<string, SearchColumns>;
  today: string;
  testId: string;
  onAdd: (
    searches: TargetSearch[],
    remember: { source: string; columns: SearchColumns },
  ) => void;
  onCancel: () => void;
}) {
  const named = Object.keys(sources);
  const [text, setText] = useState("");
  const [source, setSource] = useState(named[0] ?? DEFAULT_SOURCES[0]);
  const [readOn, setReadOn] = useState(today);
  const [chosen, setChosen] = useState<Partial<SearchColumns> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const table = useMemo(() => parseTable(text), [text]);
  // The maker's own mapping wins; else the one saved for the source, when
  // this table has its headers; else Kiln's guess.
  const saved = sources[source.trim()];
  const columns: Partial<SearchColumns> =
    chosen ??
    (saved && columnsFit(saved, table.headers)
      ? saved
      : guessColumns(table.headers));
  const result = columns.term
    ? searchesFromTable(table, columns as SearchColumns, {
        source: source.trim() || "typed",
        readOn,
      })
    : null;
  const ready =
    result !== null &&
    result.searches.length > 0 &&
    source.trim() !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(readOn);

  const pick = (column: SearchColumn, header: string) =>
    setChosen({ ...columns, [column]: header || undefined });

  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 rounded-field bg-surface-soft p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={LABEL}>Paste a table, or open a CSV</span>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
          className="hidden"
          onChange={async (e) => {
            const chosenFile = e.target.files?.[0];
            e.target.value = "";
            if (!chosenFile) return;
            if (chosenFile.size > MAX_FILE_BYTES) {
              setError("That file is over 1 MB; a search table is smaller.");
              return;
            }
            setError(null);
            setChosen(null);
            setText(await chosenFile.text());
          }}
        />
        <Button
          variant="ghost"
          size="xs"
          data-testid={`${testId}-file`}
          onClick={() => file.current?.click()}
        >
          <FileUp /> Open a CSV
        </Button>
      </div>
      <textarea
        aria-label="Search table"
        data-testid={`${testId}-text`}
        rows={6}
        value={text}
        placeholder={
          "| Term | Searches | Results | Conversion | Median purchase |\n| cutting board | 27.9k | 33.1k | Low | $14.40–17.60 |"
        }
        onChange={(e) => {
          setText(e.target.value);
          setChosen(null);
        }}
        className={`${FIELD} resize-y font-mono text-[0.72rem] leading-relaxed`}
      />
      <p className={NOTE}>
        A CSV or TSV export, cells copied from a spreadsheet, or a Markdown
        table from your notes. The first row names the columns. Read here, in
        your browser.
      </p>
      {error ? (
        <p className="font-mono text-[0.7rem] text-prov-local">{error}</p>
      ) : null}

      {table.headers.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Source</span>
              <MaterialCombobox
                label="Source"
                value={source}
                onChange={(next) => {
                  setSource(next);
                  setChosen(null);
                }}
                options={[...new Set([...named, ...DEFAULT_SOURCES])]}
                field={FIELD}
                placeholder="Where these numbers come from"
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Read on</span>
              <input
                type="date"
                aria-label="Read on"
                value={readOn}
                max={today}
                onChange={(e) => setReadOn(e.target.value)}
                className={FIELD}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SearchColumn.options.map((column) => (
              <label key={column} className="flex min-w-0 flex-col gap-1">
                <span className={`${LABEL} truncate`}>
                  {COLUMN_LABEL[column]}
                </span>
                <select
                  aria-label={`${COLUMN_LABEL[column]} column`}
                  data-testid={`${testId}-column-${column}`}
                  value={columns[column] ?? ""}
                  onChange={(e) => pick(column, e.target.value)}
                  className={`${FIELD} py-1.5`}
                >
                  <option value="">
                    {column === "term" ? "Pick one" : "None"}
                  </option>
                  {table.headers.map((h, i) => (
                    <option
                      // biome-ignore lint/suspicious/noArrayIndexKey: a table may repeat a header
                      key={`${h}-${i}`}
                      value={h}
                    >
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className={NOTE} data-testid={`${testId}-preview`}>
            {result === null
              ? "Pick the column that holds the search term."
              : `${result.searches.length} ${result.searches.length === 1 ? "search" : "searches"} read${result.skipped > 0 ? `, ${result.skipped} ${result.skipped === 1 ? "row" : "rows"} skipped (no term, or read twice)` : ""}${
                  result.searches.length > 0
                    ? `: ${result.searches
                        .slice(0, 3)
                        .map((s) => s.term)
                        .join(", ")}${result.searches.length > 3 ? "…" : ""}`
                    : "."
                }`}
            {saved && columnsFit(saved, table.headers) && chosen === null
              ? ` Columns as you mapped ${source.trim()} before.`
              : ""}
          </p>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          data-testid={`${testId}-add`}
          disabled={!ready}
          onClick={() => {
            if (!result || !columns.term) return;
            onAdd(result.searches, {
              source: source.trim(),
              columns: columns as SearchColumns,
            });
          }}
          className="font-semibold shadow-button"
        >
          Add {result?.searches.length ?? 0}{" "}
          {result?.searches.length === 1 ? "search" : "searches"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

"use client";

import {
  ArrowUp,
  ChevronDown,
  Loader2,
  MapPin,
  Plus,
  Save,
  Table2,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, useTransition } from "react";
import { setSlotPlaceAction } from "@/app/actions/board";
import { saveBriefAction } from "@/app/actions/market-brief";
import { SearchTableImport } from "@/components/projects/search-table-import";
import { Button } from "@/components/ui/button";
import {
  bandLabel,
  CONVERSION_LABELS,
  Conversion,
  MAX_NOTES,
  MAX_SEARCHES,
  type MarketBrief,
  mergeSearches,
  type PageOneNote,
  type PriceBand,
  priceCheck,
  readConversion,
  readCount,
  readPriceBand,
  type SearchColumns,
  type TargetSearch,
} from "@/domain/market-brief";
import type { Product } from "@/domain/product";
import { cn } from "@/lib/utils";

const LABEL =
  "font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const FIELD =
  "w-full min-w-0 rounded-field border border-border bg-secondary px-2.5 py-1.5 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";
const NOTE = "font-sans text-[0.75rem] leading-snug text-on-surface-mid";
const STALE_DAYS = 90;

const money = (n: number) => n.toFixed(2);
const compact = (n: number) =>
  n >= 10_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
      : `${n}`;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// A cell typed the way the maker reads it ("27.9k", "$14.40–17.60", "High",
// "0.49 %"), read when they leave it with the same readers a pasted table
// goes through.
function ReadInput({
  value,
  read,
  label,
  testId,
  placeholder,
  list,
}: {
  value: string;
  read: (text: string) => string | null;
  label: string;
  testId: string;
  placeholder?: string;
  list?: string;
}) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  return (
    <input
      aria-label={label}
      data-testid={testId}
      value={text}
      placeholder={placeholder}
      list={list}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() === value) {
          setText(value);
          return;
        }
        setText(read(text) ?? value);
      }}
      className={FIELD}
    />
  );
}

// A value with its own label on a narrow card; the header row names the
// columns on a wide one.
function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={cn(LABEL, "truncate @2xl:hidden")}>{label}</span>
      {children}
    </div>
  );
}

const countText = (n: number | undefined) => (n === undefined ? "" : `${n}`);
const conversionText = (s: TargetSearch) =>
  s.conversion
    ? CONVERSION_LABELS[s.conversion]
    : s.conversionRate !== undefined
      ? `${s.conversionRate} %`
      : "";
const priceText = (band: PriceBand | undefined) =>
  band ? bandLabel(band) : "";

// A listing's market brief on the board (ROADMAP Phase 20): the searches it
// aims at (the first leads: the title should name it), each with its source
// and date, and what page 1 shows for them, in words. A note's place can be
// handed to a frame, which then stands there; the price is set beside the
// band that sells, as a warning. All of it is the maker's research, kept
// with the project; Kiln reads no marketplace.
export function MarketBriefPanel({
  projectId,
  destinationId,
  destinationName,
  initial,
  product,
  sources,
  frames,
  today,
}: {
  projectId: string;
  destinationId: string;
  destinationName: string;
  initial: MarketBrief | undefined;
  product: Product;
  // The column mappings saved per source.
  sources: Record<string, SearchColumns>;
  // This destination's scenes that can take a place.
  frames: { key: string; label: string }[];
  // The server's date (YYYY-MM-DD), so the ages agree with the page.
  today: string;
}) {
  const [brief, setBrief] = useState<MarketBrief>(
    initial ?? { searches: [], notes: [] },
  );
  const [dirty, setDirty] = useState(false);
  const [importing, setImporting] = useState(false);
  const [remember, setRemember] = useState<{
    source: string;
    columns: SearchColumns;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [placing, startPlacing] = useTransition();
  const testId = `brief-${destinationId}`;
  const empty = brief.searches.length === 0 && brief.notes.length === 0;
  const check = priceCheck(product, brief);

  const change = (next: Partial<MarketBrief>) => {
    setBrief((current) => ({ ...current, ...next }));
    setDirty(true);
  };
  const editSearch = (index: number, patch: Partial<TargetSearch>) =>
    change({
      searches: brief.searches.map((s, i) =>
        i === index ? { ...s, ...patch } : s,
      ),
    });
  const editNote = (index: number, patch: Partial<PageOneNote>) =>
    change({
      notes: brief.notes.map((n, i) => (i === index ? { ...n, ...patch } : n)),
    });

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveBriefAction({
        projectId,
        destinationId,
        brief,
        ...(remember ? { columns: remember } : {}),
      });
      if (result?.error) setError(result.error);
      else {
        setDirty(false);
        setRemember(null);
      }
    });
  }

  function handPlace(place: string, frame: { key: string; label: string }) {
    setError(null);
    setPlaced(null);
    startPlacing(async () => {
      const result = await setSlotPlaceAction({
        projectId,
        destinationId,
        slotKey: frame.key,
        place,
      });
      if (result?.error) setError(result.error);
      else
        setPlaced(
          `${frame.label} stands in it now; its scene was written again. Nothing was spent.`,
        );
    });
  }

  return (
    <div
      data-testid={testId}
      className="@container flex flex-col gap-4 rounded-card bg-card p-6 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-[620px] flex-col gap-1">
          <h3 className="font-serif text-lg italic text-foreground">
            Market brief{" "}
            <span className="ml-1 font-sans text-[0.7rem] not-italic text-on-surface-dim">
              optional
            </span>
          </h3>
          <p className="font-sans text-[0.8rem] leading-snug text-on-surface-mid">
            Why this {destinationName} listing looks as it does: the searches it
            aims at and what page 1 shows for them. Your research, kept with the
            project; Kiln never reads the marketplace.
          </p>
          {brief.carriedFrom ? (
            <p className="font-mono text-[0.65rem] text-on-surface-dim">
              From {brief.carriedFrom}. Check the dates before you trust the
              numbers.
            </p>
          ) : null}
          {check ? (
            <p
              data-testid={`${testId}-price`}
              className={cn(
                "font-mono text-[0.68rem]",
                check.where === "inside"
                  ? "text-prov-recipe"
                  : "text-prov-brand",
              )}
            >
              Your price {money(check.price)} is {check.where} the{" "}
              {bandLabel(check.band)} band that sells for "{check.term}".
              {check.where === "inside" ? "" : " The price is yours."}
            </p>
          ) : null}
        </div>
        {initial !== undefined || dirty ? (
          <Button
            size="sm"
            data-testid={`${testId}-save`}
            disabled={pending || !dirty}
            onClick={save}
            className="font-semibold shadow-button"
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            {dirty ? "Save" : "Saved"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="font-mono text-[0.7rem] text-prov-local">{error}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Target searches</span>
        {brief.searches.length > 0 ? (
          <>
            <div className="hidden grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))_3.5rem] gap-2 @2xl:grid">
              {[
                "Term",
                "Searches / mo",
                "Results",
                "Conversion",
                "Median price",
              ].map((h) => (
                <span key={h} className={LABEL}>
                  {h}
                </span>
              ))}
            </div>
            <datalist id={`${testId}-conversion`}>
              {Conversion.options.map((c) => (
                <option key={c} value={CONVERSION_LABELS[c]} />
              ))}
            </datalist>
            <ol className="flex flex-col gap-2">
              {brief.searches.map((s, i) => {
                const age = daysBetween(s.readOn, today);
                return (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, terms change as typed
                    key={i}
                    data-testid={`${testId}-search-${i + 1}`}
                    className="flex flex-col gap-1"
                  >
                    <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-end gap-2 @2xl:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))_3.5rem]">
                      <input
                        aria-label={`Search ${i + 1} term`}
                        data-testid={`${testId}-search-${i + 1}-term`}
                        value={s.term}
                        placeholder="the words buyers type"
                        onChange={(e) =>
                          editSearch(i, { term: e.target.value })
                        }
                        className={cn(FIELD, "col-span-5 @2xl:col-span-1")}
                      />
                      <Cell label="Searches / mo">
                        <ReadInput
                          label={`Search ${i + 1} searches a month`}
                          testId={`${testId}-search-${i + 1}-searches`}
                          value={countText(s.searches)}
                          placeholder="27.9k"
                          read={(text) => {
                            const n = readCount(text);
                            editSearch(i, { searches: n });
                            return countText(n);
                          }}
                        />
                      </Cell>
                      <Cell label="Results">
                        <ReadInput
                          label={`Search ${i + 1} results`}
                          testId={`${testId}-search-${i + 1}-results`}
                          value={countText(s.results)}
                          placeholder="33.1k"
                          read={(text) => {
                            const n = readCount(text);
                            editSearch(i, { results: n });
                            return countText(n);
                          }}
                        />
                      </Cell>
                      <Cell label="Conversion">
                        <ReadInput
                          label={`Search ${i + 1} conversion`}
                          testId={`${testId}-search-${i + 1}-conversion`}
                          value={conversionText(s)}
                          placeholder="High, or 0.49 %"
                          list={`${testId}-conversion`}
                          read={(text) => {
                            const read = readConversion(text);
                            const next = {
                              ...s,
                              conversion: read.conversion,
                              conversionRate: read.conversionRate,
                            };
                            editSearch(i, {
                              conversion: read.conversion,
                              conversionRate: read.conversionRate,
                            });
                            return conversionText(next);
                          }}
                        />
                      </Cell>
                      <Cell label="Median price">
                        <ReadInput
                          label={`Search ${i + 1} median price`}
                          testId={`${testId}-search-${i + 1}-price`}
                          value={priceText(s.price)}
                          placeholder="14.40–17.60"
                          read={(text) => {
                            const band = readPriceBand(text);
                            editSearch(i, { price: band });
                            return priceText(band);
                          }}
                        />
                      </Cell>
                      <div className="flex items-center justify-end gap-0.5">
                        {i > 0 ? (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Make search ${i + 1} the lead`}
                            title="Make it the lead search"
                            data-testid={`${testId}-search-${i + 1}-lead`}
                            onClick={() =>
                              change({
                                searches: [
                                  s,
                                  ...brief.searches.filter((_, j) => j !== i),
                                ],
                              })
                            }
                          >
                            <ArrowUp />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove search ${i + 1}`}
                          data-testid={`${testId}-search-${i + 1}-remove`}
                          onClick={() =>
                            change({
                              searches: brief.searches.filter(
                                (_, j) => j !== i,
                              ),
                            })
                          }
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                    <span className="font-mono text-[0.6rem] text-on-surface-dim">
                      {i === 0 ? (
                        <span className="mr-1.5 rounded-badge bg-primary/10 px-[6px] py-px text-primary">
                          lead
                        </span>
                      ) : null}
                      {s.source} · read {s.readOn}
                      {age > STALE_DAYS ? (
                        <span className="text-prov-brand">
                          {" "}
                          · {Math.round(age / 30)} months old
                        </span>
                      ) : null}
                      {s.searches !== undefined
                        ? ` · ${compact(s.searches)} a month`
                        : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className={NOTE}>
            The searches this listing should be found by: how many buyers type
            each, how many listings compete, how often it ends in a purchase,
            and the price buyers paid. The first one leads.
          </p>
        )}
        {importing ? (
          <SearchTableImport
            sources={sources}
            today={today}
            testId={`${testId}-import`}
            onCancel={() => setImporting(false)}
            onAdd={(added, mapping) => {
              const merged = mergeSearches(brief.searches, added);
              change({ searches: merged.searches });
              setRemember(mapping);
              setImporting(false);
              setError(
                merged.added + merged.updated < added.length
                  ? `A brief holds ${MAX_SEARCHES} searches; ${added.length - merged.added - merged.updated} were left out.`
                  : null,
              );
            }}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {!importing ? (
            <Button
              variant="secondary"
              size="sm"
              data-testid={`${testId}-import-open`}
              onClick={() => setImporting(true)}
            >
              <Table2 /> Paste or open a table
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            data-testid={`${testId}-add-search`}
            disabled={brief.searches.length >= MAX_SEARCHES}
            onClick={() =>
              change({
                searches: [
                  ...brief.searches,
                  { term: "", source: "Typed", readOn: today },
                ],
              })
            }
          >
            <Plus /> Add a search
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>What page 1 shows</span>
        {brief.notes.length === 0 ? (
          <p className={NOTE}>
            The heroes buyers see for a search, in your words ("small, close,
            beside the front door"). Give a note the place it suggests and hand
            it to a frame: the frame stands there, made from your product.
            Another seller's photo is never an input.
          </p>
        ) : null}
        <ol className="flex flex-col gap-3">
          {brief.notes.map((n, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: notes are edited in place
              key={i}
              data-testid={`${testId}-note-${i + 1}`}
              className="flex flex-col gap-2 rounded-field bg-surface-soft p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Note ${i + 1} search`}
                  value={n.term}
                  onChange={(e) => editNote(i, { term: e.target.value })}
                  className={cn(FIELD, "w-auto max-w-[260px]")}
                >
                  <option value="">Any search</option>
                  {brief.searches
                    .filter((s) => s.term.trim())
                    .map((s) => (
                      <option key={s.term} value={s.term}>
                        {s.term}
                      </option>
                    ))}
                </select>
                <span className="font-mono text-[0.6rem] text-on-surface-dim">
                  read {n.readOn}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label={`Remove note ${i + 1}`}
                  onClick={() =>
                    change({ notes: brief.notes.filter((_, j) => j !== i) })
                  }
                >
                  <X />
                </Button>
              </div>
              <textarea
                aria-label={`Note ${i + 1}`}
                data-testid={`${testId}-note-${i + 1}-text`}
                rows={2}
                value={n.note}
                placeholder="What the first heroes show: the setting, how close, what is beside it"
                onChange={(e) => editNote(i, { note: e.target.value })}
                className={cn(FIELD, "resize-y")}
              />
              <div className="flex flex-wrap items-center gap-2">
                <MapPin className="size-3.5 flex-shrink-0 text-on-surface-mid" />
                <input
                  aria-label={`Note ${i + 1} place`}
                  data-testid={`${testId}-note-${i + 1}-place`}
                  value={n.place}
                  placeholder="The place it suggests for a frame"
                  onChange={(e) => editNote(i, { place: e.target.value })}
                  className={cn(FIELD, "min-w-[200px] flex-1")}
                />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid={`${testId}-note-${i + 1}-use`}
                      disabled={
                        !n.place.trim() || frames.length === 0 || placing
                      }
                    >
                      {placing ? <Loader2 className="animate-spin" /> : null}
                      Use it for <ChevronDown />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={4}
                      className="z-50 min-w-[12rem] rounded-field bg-card p-1 shadow-card ring-1 ring-border"
                    >
                      {frames.map((frame) => (
                        <DropdownMenu.Item
                          key={frame.key}
                          data-testid={`${testId}-note-${i + 1}-use-${frame.key}`}
                          onSelect={() => handPlace(n.place.trim(), frame)}
                          className="cursor-pointer rounded-[9px] px-2.5 py-1.5 font-sans text-sm text-foreground outline-none data-[highlighted]:bg-secondary"
                        >
                          {frame.label}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </li>
          ))}
        </ol>
        {placed ? (
          <p className="font-mono text-[0.68rem] text-prov-recipe">{placed}</p>
        ) : null}
        <div>
          <Button
            variant="ghost"
            size="sm"
            data-testid={`${testId}-add-note`}
            disabled={brief.notes.length >= MAX_NOTES}
            onClick={() =>
              change({
                notes: [
                  ...brief.notes,
                  {
                    term: brief.searches[0]?.term ?? "",
                    note: "",
                    place: "",
                    readOn: today,
                  },
                ],
              })
            }
          >
            <Plus /> Add a page-1 note
          </Button>
        </div>
      </div>
      {empty && !dirty ? null : (
        <p className="font-sans text-[0.7rem] text-on-surface-dim">
          {remember
            ? `Saving also remembers how ${remember.source} tables are mapped.`
            : "Saved with the project; a new project of this product starts from it."}
        </p>
      )}
    </div>
  );
}

"use client";

import { Loader2, PenLine, Plus, Save, Store, X } from "lucide-react";
import { useState, useTransition } from "react";
import {
  readFromShopAction,
  saveReadAction,
  setFollowingAction,
  setListingUrlAction,
  setLiveOnAction,
} from "@/app/actions/listing-results";
import { Button } from "@/components/ui/button";
import {
  changeLabel,
  daysIn,
  METRIC_LABELS,
  type Metric,
  READ_LABELS,
  type ReadKey,
} from "@/domain/listing-results";
import { etsyListingId } from "@/domain/live-listing";
import {
  dayLabel,
  type ResultsRead,
  type ResultsView,
} from "@/lib/results-view";
import { cn } from "@/lib/utils";

const LABEL =
  "font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const FIELD =
  "w-full min-w-0 rounded-field border border-border bg-secondary px-2.5 py-1.5 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";
const NOTE = "font-sans text-[0.75rem] leading-snug text-on-surface-mid";

// The numbers in the order the stats page shows them.
const METRICS: Metric[] = [
  "visits",
  "orders",
  "views",
  "favourites",
  "revenue",
  "searchVisits",
];

const shown = (metric: Metric, n: number) =>
  metric === "revenue" ? `$${n.toFixed(2)}` : n.toLocaleString("en-US");

const windowLabel = (w: { from: string; to: string }) =>
  `${dayLabel(w.from)} – ${dayLabel(w.to)} · ${daysIn(w)} days`;

// "1,234" or "$1,234.50" as typed; what does not read as a number is sent as
// it is, so the server says what is wrong with it.
function typed(text: string): unknown {
  const clean = text.replace(/[$,\s]/g, "");
  if (clean === "") return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : text;
}

// The board's results for one sale destination: the listing's address, the day
// its photos went up, the three reads (typed from the shop's stats, or read
// from a connected shop) and before against after, beside the frames that
// changed. Followed from a delivery, or from the day the maker says the photos
// went up. Kiln never opens the listing's page.
export function ListingResultsPanel({
  projectId,
  destinationId,
  destinationName,
  listingUrl,
  view,
  today,
  shop,
}: {
  projectId: string;
  destinationId: string;
  destinationName: string;
  listingUrl: string | null;
  // Null until delivered or a day is set: nothing is followed yet.
  view: ResultsView | null;
  today: string;
  // The connected shop's name, or null: the numbers are typed.
  shop: string | null;
}) {
  const testId = `results-${destinationId}`;
  const where = { projectId, destinationId };
  const [pending, start] = useTransition();
  // What went wrong, said in the read it is about (else above them all).
  const [error, setError] = useState<{
    at: ReadKey | null;
    message: string;
  } | null>(null);
  const [editingUrl, setEditingUrl] = useState(listingUrl === null);
  const [url, setUrl] = useState(listingUrl ?? "");
  const listingId = listingUrl ? etsyListingId(listingUrl) : null;

  const act = (
    work: () => Promise<{ error: string } | undefined>,
    at: ReadKey | null = null,
  ) =>
    start(async () => {
      const result = await work();
      setError(result ? { at, message: result.error } : null);
    });

  return (
    <div
      id={testId}
      data-testid={testId}
      className="@container flex scroll-mt-6 flex-col gap-4 rounded-card bg-card p-6 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-[620px] flex-col gap-1">
          <h3 className="font-serif text-lg text-foreground">Results</h3>
          <p className="font-sans text-[0.8rem] leading-snug text-on-surface-mid">
            Is the new {destinationName} listing working? Read its numbers from
            your shop's stats before the photos went up, and 14 and 30 days
            after.
          </p>
        </div>
        {view ? (
          <Button
            variant="ghost"
            size="xs"
            data-testid={`${testId}-follow`}
            disabled={pending}
            onClick={() =>
              act(() =>
                setFollowingAction({ ...where, following: !view.following }),
              )
            }
          >
            {view.following ? "Stop following" : "Follow again"}
          </Button>
        ) : null}
      </div>
      {error && error.at === null ? (
        <p className="font-mono text-[0.7rem] text-fail">{error.message}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={LABEL}>The listing</span>
          {editingUrl ? (
            <div className="flex gap-2">
              <input
                aria-label="Listing address"
                data-testid={`${testId}-url`}
                value={url}
                placeholder="https://www.etsy.com/listing/…"
                onChange={(e) => setUrl(e.target.value)}
                className={FIELD}
              />
              <Button
                size="sm"
                data-testid={`${testId}-url-save`}
                disabled={pending || url.trim() === (listingUrl ?? "")}
                onClick={() =>
                  act(() =>
                    setListingUrlAction({ ...where, url: url.trim() || null }),
                  )
                }
              >
                Keep
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-baseline gap-2">
              <a
                href={listingUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate font-sans text-sm font-semibold text-primary hover:underline"
              >
                Live listing{listingId ? ` ${listingId}` : ""} ↗
              </a>
              <Button
                variant="ghost"
                size="xs"
                aria-label="Change the listing address"
                data-testid={`${testId}-url-edit`}
                onClick={() => setEditingUrl(true)}
              >
                <PenLine /> Change
              </Button>
            </div>
          )}
          <p className={NOTE}>
            {listingUrl
              ? "Kept to name the listing; Kiln never opens the page."
              : "Paste its address once it is live: it names the listing for the reads. Kiln never opens the page."}
          </p>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={LABEL}>Photos went up</span>
          <input
            type="date"
            aria-label="Photos went up"
            data-testid={`${testId}-live-on`}
            value={view?.liveOn ?? ""}
            max={today}
            disabled={pending}
            onChange={(e) =>
              e.target.value &&
              act(() => setLiveOnAction({ ...where, liveOn: e.target.value }))
            }
            className={FIELD}
          />
          <span className={NOTE}>
            {!view ? (
              "Not delivered from Kiln yet: once the new photos are up on the listing, set the day. The reads count from it."
            ) : view.liveOnSet ? (
              <>
                The day you set.{" "}
                {view.deliveredOn ? (
                  <button
                    type="button"
                    data-testid={`${testId}-live-on-reset`}
                    className="font-semibold text-primary hover:underline"
                    onClick={() =>
                      act(() => setLiveOnAction({ ...where, liveOn: null }))
                    }
                  >
                    Back to the delivery ({dayLabel(view.deliveredOn)})
                  </button>
                ) : null}
              </>
            ) : (
              "The day you delivered; change it to the day the photos went up. The reads count from it."
            )}
          </span>
        </label>
      </div>

      {view ? (
        <ListingReads
          view={view}
          testId={testId}
          destinationName={destinationName}
          today={today}
          shop={shop}
          pending={pending}
          error={error}
          onSave={(key, read) =>
            act(() => saveReadAction({ ...where, key, read }), key)
          }
          onShop={(key) =>
            act(() => readFromShopAction({ ...where, key }), key)
          }
        />
      ) : null}
    </div>
  );
}

// The three reads, before against after, and what changed.
function ListingReads({
  view,
  testId,
  destinationName,
  today,
  shop,
  pending,
  error,
  onSave,
  onShop,
}: {
  view: ResultsView;
  testId: string;
  destinationName: string;
  today: string;
  shop: string | null;
  pending: boolean;
  error: { at: ReadKey | null; message: string } | null;
  onSave: (key: ReadKey, read: Record<string, unknown> | null) => void;
  onShop: (key: ReadKey) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
        {view.reads.map((r) => (
          <ReadCard
            key={`${r.key}-${JSON.stringify(r.read)}`}
            read={r}
            testId={`${testId}-read-${r.key}`}
            pending={pending}
            following={view.following}
            source={`${destinationName} stats`}
            shop={view.listingUrl && r.window.to < today ? shop : null}
            error={error?.at === r.key ? error.message : null}
            onSave={onSave}
            onShop={onShop}
          />
        ))}
      </div>

      {view.comparison ? (
        <div
          data-testid={`${testId}-comparison`}
          className="flex flex-col gap-1.5 rounded-field bg-surface-soft p-4"
        >
          <span className={LABEL}>
            Before against {READ_LABELS[view.comparison.against].toLowerCase()},
            per 30 days
          </span>
          <ul className="flex flex-col gap-1 font-sans text-[0.85rem] text-foreground">
            {view.comparison.rows.map((row) => (
              <li
                key={row.metric}
                className={cn(
                  row.change !== null && row.change > 0 && "text-prov-recipe",
                )}
              >
                {changeLabel(row)}
              </li>
            ))}
          </ul>
          {view.comparison.thin ? (
            <p className={NOTE}>
              Fewer than 30 visits in a window: a change this size can be
              chance. The 30-day read says more.
            </p>
          ) : null}
        </div>
      ) : null}

      {view.changed.length > 0 ? (
        <p className={NOTE} data-testid={`${testId}-changed`}>
          <span className="font-semibold text-foreground">What changed: </span>
          {view.changed
            .map((f) => (f.place ? `${f.label} (at ${f.place})` : f.label))
            .join(", ")}
          .
        </p>
      ) : null}
    </>
  );
}

// One read: its window, its numbers once taken, or a form to type them.
function ReadCard({
  read,
  testId,
  pending,
  following,
  source,
  shop,
  error,
  onSave,
  onShop,
}: {
  read: ResultsRead;
  testId: string;
  pending: boolean;
  following: boolean;
  source: string;
  shop: string | null;
  error: string | null;
  onSave: (key: ReadKey, read: Record<string, unknown> | null) => void;
  onShop: (key: ReadKey) => void;
}) {
  const taken = read.read;
  const [open, setOpen] = useState(false);
  const [span, setSpan] = useState(
    taken ? { from: taken.from, to: taken.to } : read.window,
  );
  const [values, setValues] = useState<Record<Metric, string>>(
    () =>
      Object.fromEntries(
        METRICS.map((m) => [
          m,
          taken?.[m] !== undefined ? String(taken[m]) : "",
        ]),
      ) as Record<Metric, string>,
  );
  const [from, setFrom] = useState(taken?.source ?? source);

  const save = () =>
    onSave(read.key, {
      ...span,
      ...Object.fromEntries(METRICS.map((m) => [m, typed(values[m])])),
      source: from,
    });

  return (
    <div
      data-testid={testId}
      className="flex min-w-0 flex-col gap-2 rounded-field border border-border-soft bg-surface-soft p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-sm font-semibold text-foreground">
          {read.label}
        </span>
        {taken ? null : read.due ? (
          <span className="font-mono text-[0.65rem] text-primary">due now</span>
        ) : (
          <span className="font-mono text-[0.65rem] text-on-surface-dim">
            {following ? `on ${dayLabel(read.dueOn)}` : "not followed"}
          </span>
        )}
      </div>
      <span className="font-mono text-[0.65rem] text-on-surface-mid">
        {windowLabel(taken ?? read.window)}
      </span>
      {read.offWindow ? (
        <p className={NOTE} data-testid={`${testId}-off-window`}>
          Read over other days: for the day the photos went up it is{" "}
          {windowLabel(read.window)}.
          {shop ? " Read it again, or edit it." : " Edit it to match."}
        </p>
      ) : null}
      {error ? (
        <p
          data-testid={`${testId}-error`}
          className="font-mono text-[0.68rem] text-fail [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>From</span>
              <input
                type="date"
                aria-label={`${read.label} from`}
                data-testid={`${testId}-from`}
                value={span.from}
                onChange={(e) => setSpan({ ...span, from: e.target.value })}
                className={FIELD}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>To</span>
              <input
                type="date"
                aria-label={`${read.label} to`}
                data-testid={`${testId}-to`}
                value={span.to}
                onChange={(e) => setSpan({ ...span, to: e.target.value })}
                className={FIELD}
              />
            </label>
            {METRICS.map((m) => (
              <label key={m} className="flex min-w-0 flex-col gap-1">
                <span className={`${LABEL} truncate`}>{METRIC_LABELS[m]}</span>
                <input
                  inputMode="decimal"
                  aria-label={`${read.label} ${METRIC_LABELS[m]}`}
                  data-testid={`${testId}-${m}`}
                  value={values[m]}
                  placeholder={m === "revenue" ? "$" : "—"}
                  onChange={(e) =>
                    setValues({ ...values, [m]: e.target.value })
                  }
                  className={FIELD}
                />
              </label>
            ))}
          </div>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={LABEL}>Read from</span>
            <input
              aria-label={`${read.label} source`}
              data-testid={`${testId}-source`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={FIELD}
            />
          </label>
          <p className={NOTE}>
            The numbers for these days, as the stats page shows them; leave out
            what it does not show.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              data-testid={`${testId}-save`}
              disabled={pending}
              onClick={save}
              className="font-semibold shadow-button"
            >
              {pending ? <Loader2 className="animate-spin" /> : <Save />}
              Keep
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`${testId}-cancel`}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : taken ? (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            {METRICS.flatMap((m) =>
              taken[m] === undefined
                ? []
                : [
                    <div key={m} className="flex min-w-0 flex-col">
                      <dt className={`${LABEL} truncate`}>
                        {METRIC_LABELS[m]}
                      </dt>
                      <dd className="font-serif text-base text-foreground">
                        {shown(m, taken[m] as number)}
                      </dd>
                    </div>,
                  ],
            )}
          </dl>
          <span className="font-mono text-[0.62rem] text-on-surface-dim">
            {taken.source}, read {dayLabel(taken.readOn)}
          </span>
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="xs"
              data-testid={`${testId}-edit`}
              onClick={() => setOpen(true)}
            >
              <PenLine /> Edit
            </Button>
            <Button
              variant="ghost"
              size="xs"
              data-testid={`${testId}-remove`}
              disabled={pending}
              onClick={() => onSave(read.key, null)}
            >
              <X /> Remove
            </Button>
            {shop ? (
              <Button
                variant="ghost"
                size="xs"
                data-testid={`${testId}-shop`}
                disabled={pending}
                onClick={() => onShop(read.key)}
              >
                <Store /> Read again
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="xs"
            data-testid={`${testId}-type`}
            onClick={() => setOpen(true)}
          >
            <Plus /> Type the numbers
          </Button>
          {shop ? (
            <Button
              variant="ghost"
              size="xs"
              data-testid={`${testId}-shop`}
              disabled={pending}
              onClick={() => onShop(read.key)}
            >
              <Store /> Read from {shop}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

import { ChevronDown, ExternalLink, ImagePlus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { LeaveOut } from "@/components/shops/leave-out";
import { ListingThumb } from "@/components/shops/listing-thumb";
import { Segmented } from "@/components/shops/segmented";
import { Button } from "@/components/ui/button";
import {
  moneyLabel,
  RANK_BY,
  RANK_WINDOWS,
  type RankBy,
} from "@/domain/shop-ranking";
import { dayLabel } from "@/lib/results-view";
import {
  LISTING_NOW_LABEL,
  RANK_BY_LABEL,
  type ShopsQuery,
  shopsHref,
  windowLabel,
  windowSince,
} from "@/lib/shops-view";
import type { BestSeller, BestSellersView } from "@/server/shop-ranking";

const LABEL =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";

// The rows shown before "Show the other …".
const SHOWN = 10;

const count = (n: number) => n.toLocaleString("en-US");
const lastSold = (row: BestSeller) =>
  dayLabel(new Date(row.lastSoldAt * 1000).toISOString().slice(0, 10));

const ROW_GRID =
  "grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[56px_minmax(0,1fr)_3.75rem_3.75rem_5.5rem_9.5rem] sm:gap-x-4";

function metricValue(row: BestSeller, by: RankBy): string {
  if (by === "orders") return count(row.orders);
  if (by === "units") return count(row.units);
  return moneyLabel(row.revenue, row.currency);
}

// Shops → your shop: its listings over a window, ranked by orders (or units,
// or revenue), each with its photo and a way to refresh it; one-offs and
// deleted listings set aside below.
export function BestSellers({
  view,
  query,
}: {
  view: BestSellersView;
  query: ShopsQuery;
}) {
  const top = view.rows.slice(0, SHOWN);
  const rest = view.rows.slice(SHOWN);
  const tiles = [
    { label: "Orders", value: count(view.totals.orders) },
    { label: "Units", value: count(view.totals.units) },
    {
      label: "Revenue",
      value: moneyLabel(view.totals.revenue, view.totals.currency),
    },
    { label: "Listings sold", value: count(view.totals.listings) },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="best-sellers">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Segmented
            label="Window"
            testId="best-sellers-window"
            options={RANK_WINDOWS.map((days) => ({
              id: String(days),
              label: windowLabel(days),
              current: days === view.window,
              href: shopsHref(query, { window: days }),
            }))}
          />
          <Segmented
            label="Rank by"
            testId="best-sellers-by"
            options={RANK_BY.map((by) => ({
              id: by,
              label: RANK_BY_LABEL[by],
              current: by === view.by,
              href: shopsHref(query, { by }),
            }))}
          />
        </div>
        <Link
          href={shopsHref(query, { fresh: true })}
          scroll={false}
          data-testid="best-sellers-read-again"
          className="inline-flex h-7 items-center gap-1.5 rounded-field px-2 font-sans text-[0.78rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <RefreshCw className="size-3.5" /> Read again
        </Link>
      </div>

      <dl
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        data-testid="best-sellers-totals"
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            className="flex flex-col gap-1 rounded-render bg-surface-soft px-4 py-3"
          >
            <dt className={LABEL}>{t.label}</dt>
            <dd className="font-serif text-xl italic tabular-nums text-foreground">
              {t.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="-mt-1 font-sans text-[0.75rem] leading-relaxed text-on-surface-mid">
        From {view.shopName}&apos;s own receipts over {windowSince(view.window)}{" "}
        (since {dayLabel(view.from)}); canceled and refunded orders are left
        out.
        {view.complete ? "" : " Only the newest 5,000 orders were read."}
        {view.detailsProblem ? ` ${view.detailsProblem}` : ""}
      </p>

      {view.rows.length === 0 ? (
        <p
          className="rounded-render border border-border-soft bg-surface-soft p-4 font-sans text-sm text-on-surface-mid"
          data-testid="best-sellers-none"
        >
          No listing sold in {windowSince(view.window)}.
        </p>
      ) : (
        <div className="overflow-hidden rounded-render border border-border-soft bg-card">
          <div
            aria-hidden="true"
            className={`${ROW_GRID} hidden border-border-soft border-b bg-surface-soft px-4 py-2 sm:grid`}
          >
            <span className={LABEL}>#</span>
            <span className={LABEL}>Listing</span>
            {RANK_BY.map((by) => (
              <span
                key={by}
                className={`${LABEL} text-right ${by === view.by ? "text-foreground" : ""}`}
              >
                {RANK_BY_LABEL[by]}
              </span>
            ))}
            <span />
          </div>
          <ol className="divide-y divide-border-soft">
            {top.map((row, i) => (
              <Row key={row.listingId} row={row} rank={i + 1} by={view.by} />
            ))}
          </ol>
          {rest.length > 0 ? (
            <details className="group border-border-soft border-t">
              <summary
                className="flex cursor-pointer list-none items-center justify-center gap-1.5 px-4 py-2.5 font-sans text-[0.78rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"
                data-testid="best-sellers-more"
              >
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                <span className="group-open:hidden">
                  Show the other {rest.length}
                </span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ol className="divide-y divide-border-soft border-border-soft border-t">
                {rest.map((row, i) => (
                  <Row
                    key={row.listingId}
                    row={row}
                    rank={SHOWN + i + 1}
                    by={view.by}
                  />
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      )}

      {view.setAside.length > 0 ? <SetAside rows={view.setAside} /> : null}

      <span className={LABEL}>
        Read{" "}
        {new Date(view.readAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })}{" "}
        · kept ten minutes
      </span>
    </div>
  );
}

function Row({ row, rank, by }: { row: BestSeller; rank: number; by: RankBy }) {
  const note = LISTING_NOW_LABEL[row.now];
  return (
    <li
      className={`${ROW_GRID} px-3 py-3 sm:px-4`}
      data-testid={`best-seller-${row.listingId}`}
    >
      <span className="relative">
        <ListingThumb src={row.photo} />
        <span className="absolute -top-1.5 -left-1.5 flex h-5 min-w-5 items-center justify-center rounded-pill bg-card px-1 font-mono text-[0.6rem] text-foreground shadow-[0_2px_6px_-1px_rgba(50,32,18,0.25)]">
          {rank}
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group/title inline-flex min-w-0 items-start gap-1 font-sans text-[0.84rem] font-semibold leading-snug text-foreground hover:text-primary"
        >
          <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">
            {row.title}
          </span>
          <ExternalLink className="mt-0.5 size-3 flex-shrink-0 text-on-surface-dim group-hover/title:text-primary" />
        </a>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-[0.72rem] text-on-surface-mid">
          <span className="sm:hidden">
            {RANK_BY.map((b, n) => (
              <span key={b}>
                {n > 0 ? " · " : ""}
                <span
                  className={
                    b === by ? "font-semibold text-foreground" : undefined
                  }
                >
                  {metricValue(row, b)}
                </span>{" "}
                {b === "revenue" ? "" : b}
              </span>
            ))}
          </span>
          <span>last sold {lastSold(row)}</span>
          {note ? (
            <span className="rounded-badge bg-prov-brand/10 px-1.5 py-px font-mono text-[0.6rem] text-prov-brand">
              {note}
            </span>
          ) : null}
          {row.project ? (
            <span className="rounded-badge bg-prov-recipe/10 px-1.5 py-px font-mono text-[0.6rem] text-prov-recipe">
              in Kiln
            </span>
          ) : null}
        </div>
      </div>
      {RANK_BY.map((b) => (
        <span
          key={b}
          className={`hidden text-right font-sans text-[0.84rem] tabular-nums sm:block ${
            b === by ? "font-semibold text-foreground" : "text-on-surface-mid"
          }`}
        >
          {metricValue(row, b)}
        </span>
      ))}
      <div className="col-start-2 flex items-center gap-1 sm:col-start-auto sm:justify-end">
        {row.project ? (
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/projects/${row.project.id}`}
              title={row.project.name}
              data-testid={`best-seller-${row.listingId}-project`}
            >
              Open project
            </Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/projects/new?listing=${encodeURIComponent(row.url)}&title=${encodeURIComponent(row.title)}`}
              data-testid={`best-seller-${row.listingId}-refresh`}
            >
              <ImagePlus /> Refresh photos
            </Link>
          </Button>
        )}
        <LeaveOut listingId={row.listingId} title={row.title} out={false} />
      </div>
    </li>
  );
}

// Listings that sold but are not products to refresh: made for one buyer,
// deleted since, or left out by the maker. Their sales still count above.
function SetAside({ rows }: { rows: BestSeller[] }) {
  return (
    <details
      className="group rounded-render border border-border-soft bg-surface-soft"
      data-testid="best-sellers-set-aside"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="font-sans text-[0.8rem] text-on-surface-mid">
          <span className="font-semibold text-foreground">Set aside</span> ·{" "}
          {rows.length} {rows.length === 1 ? "listing" : "listings"} not ranked
        </span>
        <ChevronDown className="size-4 text-on-surface-mid transition-transform group-open:rotate-180" />
      </summary>
      <p className="px-4 pb-3 font-sans text-[0.75rem] leading-relaxed text-on-surface-mid">
        Made for one buyer (a custom order or an upgrade), no longer on Etsy, or
        left out by you. Their orders still count in the totals above.
      </p>
      <ul className="divide-y divide-border-soft border-border-soft border-t">
        {rows.map((row) => (
          <li
            key={row.listingId}
            className="flex items-center gap-3 px-4 py-2.5"
            data-testid={`set-aside-${row.listingId}`}
          >
            <ListingThumb src={row.photo} size={40} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="line-clamp-1 font-sans text-[0.78rem] font-semibold text-foreground [overflow-wrap:anywhere] hover:text-primary"
              >
                {row.title}
              </a>
              <span className="font-sans text-[0.7rem] text-on-surface-mid">
                <span className="font-mono text-[0.6rem] text-prov-brand">
                  {row.leftOut
                    ? "Left out by you"
                    : (LISTING_NOW_LABEL[row.now] ?? "")}
                </span>{" "}
                · {count(row.orders)} {row.orders === 1 ? "order" : "orders"} ·{" "}
                {moneyLabel(row.revenue, row.currency)}
              </span>
            </div>
            {row.leftOut ? (
              <LeaveOut listingId={row.listingId} title={row.title} out />
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

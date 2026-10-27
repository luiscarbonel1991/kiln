import { ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import {
  moneyLabel,
  RANK_WINDOWS,
  type RankWindow,
} from "@/domain/shop-ranking";
import { dayLabel } from "@/lib/results-view";
import type { BestSellersView } from "@/server/shop-ranking";

const LABEL =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";

const TAB =
  "inline-flex h-7 items-center rounded-field px-2.5 font-sans text-[0.8rem] font-semibold transition-colors";

// Shops → your shop: its listings by units sold over a window, from the
// shop's own receipts, each beside its Kiln project or a way to refresh its
// photos.
export function BestSellers({ view }: { view: BestSellersView }) {
  return (
    <div className="flex flex-col gap-4" data-testid="best-sellers">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Window" className="flex flex-wrap items-center gap-1">
          {RANK_WINDOWS.map((days) => (
            <Link
              key={days}
              href={`/shops?window=${days}`}
              aria-current={days === view.window ? "page" : undefined}
              data-testid={`best-sellers-window-${days}`}
              className={`${TAB} ${
                days === view.window
                  ? "bg-primary text-primary-foreground shadow-button"
                  : "text-on-surface-mid hover:text-foreground"
              }`}
            >
              {windowLabel(days)}
            </Link>
          ))}
        </nav>
        <Link
          href={`/shops?window=${view.window}&fresh=1`}
          data-testid="best-sellers-read-again"
          className={`${TAB} gap-1 text-on-surface-mid hover:text-foreground`}
        >
          <RefreshCw className="size-3.5" /> Read again
        </Link>
      </div>

      <p className="font-sans text-[0.8rem] leading-relaxed text-on-surface-mid">
        Units sold since {dayLabel(view.from)}, from{" "}
        {view.orders.toLocaleString("en-US")}{" "}
        {view.orders === 1 ? "order" : "orders"} in {view.shopName}&apos;s
        receipts (canceled and refunded ones left out).
        {view.complete ? "" : " Only the newest 5,000 orders were read."}
      </p>

      {view.rows.length === 0 ? (
        <p
          className="rounded-render border border-border-soft bg-surface-soft p-4 font-sans text-sm text-on-surface-mid"
          data-testid="best-sellers-none"
        >
          No sales in this window.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border-soft rounded-render border border-border-soft bg-surface-soft">
          {view.rows.slice(0, 25).map((row, i) => (
            <li
              key={row.listingId}
              data-testid={`best-seller-${row.listingId}`}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <span className="w-6 flex-shrink-0 font-mono text-[0.75rem] text-on-surface-dim">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-start gap-1 font-sans text-sm font-semibold text-foreground hover:text-primary"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {row.title}
                  </span>
                  <ExternalLink className="mt-1 size-3 flex-shrink-0 text-on-surface-dim" />
                </a>
                <span className="font-sans text-[0.75rem] text-on-surface-mid">
                  <span className="font-semibold text-foreground">
                    {row.units.toLocaleString("en-US")} sold
                  </span>{" "}
                  · {row.orders.toLocaleString("en-US")}{" "}
                  {row.orders === 1 ? "order" : "orders"} ·{" "}
                  {moneyLabel(row.revenue, row.currency)} · last{" "}
                  {dayLabel(
                    new Date(row.lastSoldAt * 1000).toISOString().slice(0, 10),
                  )}
                </span>
              </div>
              <div className="flex-shrink-0 sm:text-right">
                {row.project ? (
                  <Link
                    href={`/projects/${row.project.id}`}
                    className="font-sans text-[0.75rem] font-semibold text-prov-recipe hover:underline"
                  >
                    In Kiln: {row.project.name}
                  </Link>
                ) : (
                  <Link
                    href={`/projects/new?listing=${encodeURIComponent(row.url)}`}
                    data-testid={`best-seller-${row.listingId}-refresh`}
                    className="font-sans text-[0.75rem] font-semibold text-primary hover:underline"
                  >
                    Refresh its photos
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
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

export function windowLabel(days: RankWindow): string {
  return days === 365 ? "Last year" : `Last ${days} days`;
}

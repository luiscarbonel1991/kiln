import { z } from "zod";

// The results loop (ROADMAP Phase 20): a delivered listing's numbers read
// before its new photos went up and 14 and 30 days after, each with its
// window, its source and the day it was read, so the maker sees whether the
// refresh moved anything, and which frames it changed. Numbers come typed from
// the shop's stats page, from an agent through the API, or from a shop
// connector; Kiln never opens the listing's page.

export const ReadKey = z.enum(["before", "day14", "day30"]);
export type ReadKey = z.infer<typeof ReadKey>;

export const READ_LABELS: Record<ReadKey, string> = {
  before: "Before",
  day14: "After 14 days",
  day30: "After 30 days",
};

export const Metric = z.enum([
  "visits",
  "views",
  "favourites",
  "orders",
  "revenue",
  "searchVisits",
]);
export type Metric = z.infer<typeof Metric>;

export const METRIC_LABELS: Record<Metric, string> = {
  visits: "Visits",
  views: "Views",
  favourites: "Favourites",
  orders: "Orders",
  revenue: "Revenue",
  searchVisits: "Visits from search",
};

// Under this many visits in a window, a change can be chance.
export const MIN_VISITS = 30;

const Count = z.number().int().nonnegative().max(1_000_000_000);

export const ListingRead = z
  .object({
    // The window the numbers cover, both days included.
    from: z.iso.date(),
    to: z.iso.date(),
    visits: Count.optional(),
    views: Count.optional(),
    favourites: Count.optional(),
    orders: Count.optional(),
    searchVisits: Count.optional(),
    revenue: z.number().nonnegative().max(1_000_000_000).optional(),
    source: z.string().trim().min(1).max(60),
    readOn: z.iso.date(),
  })
  .refine((r) => r.from <= r.to, {
    message: "the window ends before it starts",
    path: ["to"],
  })
  .refine((r) => Metric.options.some((m) => r[m] !== undefined), {
    message: "a read needs at least one number",
  });
export type ListingRead = z.infer<typeof ListingRead>;

export const ListingResults = z.object({
  // The day the new photos went up; absent, the day the destination was
  // last delivered.
  liveOn: z.iso.date().optional(),
  reads: z
    .object({
      before: ListingRead.optional(),
      day14: ListingRead.optional(),
      day30: ListingRead.optional(),
    })
    .default({}),
  // The maker stopped following this listing: no read is due.
  stopped: z.boolean().optional(),
});
export type ListingResults = z.infer<typeof ListingResults>;

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

// Days in a window, both ends included.
export const daysIn = (window: { from: string; to: string }) =>
  dayNumber(window.to) - dayNumber(window.from) + 1;

// The 30 days before the photos went up, and the first 14 and 30 days after.
export function readWindow(
  key: ReadKey,
  liveOn: string,
): { from: string; to: string } {
  if (key === "before") {
    return { from: addDays(liveOn, -30), to: addDays(liveOn, -1) };
  }
  return { from: liveOn, to: addDays(liveOn, key === "day14" ? 13 : 29) };
}

// A read is due once its window has passed: the before read on the day the
// photos go up, the others the day after their window ends.
export function dueOn(key: ReadKey, liveOn: string): string {
  return addDays(readWindow(key, liveOn).to, 1);
}

export interface DueRead {
  key: ReadKey;
  dueOn: string;
  window: { from: string; to: string };
}

// The reads not taken yet: those due by today, and the next one to come.
export function readsDue(
  results: ListingResults | undefined,
  liveOn: string,
  today: string,
): { due: DueRead[]; next: DueRead | null } {
  if (results?.stopped) return { due: [], next: null };
  const missing = ReadKey.options
    .filter((key) => !results?.reads[key])
    .map((key) => ({
      key,
      dueOn: dueOn(key, liveOn),
      window: readWindow(key, liveOn),
    }));
  return {
    due: missing.filter((r) => r.dueOn <= today),
    next: missing.find((r) => r.dueOn > today) ?? null,
  };
}

// The latest delivery of a destination's frames, or null before any.
export function lastDeliveredAt(destination: {
  slots: { deliveredAt?: string; off?: boolean }[];
}): string | null {
  const stamps = destination.slots.flatMap((s) =>
    !s.off && s.deliveredAt ? [s.deliveredAt] : [],
  );
  return stamps.sort().at(-1) ?? null;
}

export interface MetricChange {
  metric: Metric | "conversion";
  // Per 30 days (a count or revenue), or a share (conversion).
  before: number;
  after: number;
  // after / before - 1; null when before is zero.
  change: number | null;
}

export interface ReadComparison {
  rows: MetricChange[];
  // Too few visits in either window to tell a change from chance.
  thin: boolean;
}

const perMonth = (value: number, window: { from: string; to: string }) =>
  (value * 30) / daysIn(window);

const ratio = (before: number, after: number) =>
  before > 0 ? after / before - 1 : null;

// Before against an after read, each count brought to 30 days (the windows
// differ: 30 days before, 14 or 30 after), and conversion (orders over
// visits) where both reads have both.
export function compareReads(
  before: ListingRead,
  after: ListingRead,
): ReadComparison {
  const rows: MetricChange[] = [];
  for (const metric of Metric.options) {
    const b = before[metric];
    const a = after[metric];
    if (b === undefined || a === undefined) continue;
    const pb = perMonth(b, before);
    const pa = perMonth(a, after);
    rows.push({ metric, before: pb, after: pa, change: ratio(pb, pa) });
  }
  const conversion = (r: ListingRead) =>
    r.orders !== undefined && r.visits ? r.orders / r.visits : null;
  const cb = conversion(before);
  const ca = conversion(after);
  if (cb !== null && ca !== null) {
    rows.push({
      metric: "conversion",
      before: cb,
      after: ca,
      change: ratio(cb, ca),
    });
  }
  return {
    rows,
    thin:
      before.visits === undefined ||
      after.visits === undefined ||
      Math.min(before.visits, after.visits) < MIN_VISITS,
  };
}

// The latest after read, the one a comparison shows.
export const latestAfter = (results: ListingResults | undefined) =>
  results?.reads.day30 ?? results?.reads.day14 ?? null;

const round = (n: number) =>
  n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(n >= 10 ? 0 : 1);

export function changeLabel(row: MetricChange): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)} %`;
  const values =
    row.metric === "conversion"
      ? `${pct(row.before)} → ${pct(row.after)}`
      : row.metric === "revenue"
        ? `$${row.before.toFixed(2)} → $${row.after.toFixed(2)} a month`
        : `${round(row.before)} → ${round(row.after)} a month`;
  const change =
    row.change === null
      ? row.after > 0
        ? " (from none)"
        : ""
      : ` (${row.change >= 0 ? "+" : "−"}${Math.round(Math.abs(row.change) * 100)} %)`;
  const label =
    row.metric === "conversion" ? "Conversion" : METRIC_LABELS[row.metric];
  return `${label} ${values}${change}`;
}

// The comparison in a line: visits, then conversion (or orders).
export function comparisonLine(comparison: ReadComparison): string | null {
  const pick = (m: MetricChange["metric"]) =>
    comparison.rows.find((r) => r.metric === m);
  const lead = [pick("visits"), pick("conversion") ?? pick("orders")].filter(
    (r): r is MetricChange => r !== undefined,
  );
  const rows = lead.length > 0 ? lead : comparison.rows.slice(0, 2);
  return rows.length > 0 ? rows.map(changeLabel).join(" · ") : null;
}

// What the refresh changed: the frames that replaced a live photo, or, in a
// listing made from the product, every frame delivered (else every scene
// approved, when the maker took them out of Kiln another way). The maker's
// own photos, kept as they were, changed nothing.
export function changedFrames(destination: {
  slots: {
    key: string;
    label: string;
    fill: string;
    off?: boolean;
    deliveredAt?: string;
    approvedOutput?: string;
    before?: unknown;
    place?: string;
  }[];
}): { key: string; label: string; place?: string }[] {
  const on = destination.slots.filter((s) => !s.off && s.fill !== "photo");
  const refresh = destination.slots.some((s) => s.fill === "photo");
  const delivered = on.some((s) => s.deliveredAt);
  return on
    .filter((s) =>
      refresh
        ? s.before !== undefined
        : delivered
          ? !!s.deliveredAt
          : !!s.approvedOutput,
    )
    .map((s) => ({
      key: s.key,
      label: s.label,
      ...(s.place ? { place: s.place } : {}),
    }));
}

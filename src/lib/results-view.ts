import {
  changedFrames,
  compareReads,
  comparisonLine,
  dueOn,
  type ListingRead,
  lastDeliveredAt,
  type MetricChange,
  READ_LABELS,
  ReadKey,
  readsDue,
  readWindow,
} from "@/domain/listing-results";
import { etsyListingId } from "@/domain/live-listing";
import type { PlanDestination } from "@/domain/plan";

// What the board, Home and the API show of a sale destination's results: its
// reads (taken, due or to come), before against the latest after, and the
// frames the delivery changed. Days are the studio's local calendar days.

export const localDate = (at: Date | string = new Date()) =>
  new Date(at).toLocaleDateString("en-CA");

export interface ResultsRead {
  key: ReadKey;
  label: string;
  read: ListingRead | null;
  // The read's own window for the day the photos went up.
  window: { from: string; to: string };
  // A read taken over other days (the day it counts from moved since).
  offWindow: boolean;
  dueOn: string;
  // Not taken and its window has passed.
  due: boolean;
}

export interface ResultsView {
  listingUrl: string | null;
  listingId: string | null;
  deliveredOn: string | null;
  // The maker's day, else the day of the last delivery.
  liveOn: string;
  liveOnSet: boolean;
  following: boolean;
  reads: ResultsRead[];
  comparison: {
    against: ReadKey;
    rows: MetricChange[];
    thin: boolean;
    line: string | null;
  } | null;
  changed: { key: string; label: string; place?: string }[];
  next: { key: ReadKey; dueOn: string } | null;
}

// Null until the destination is delivered (or has results): a listing is
// followed from the day its photos can go up.
export function resultsView(
  destination: PlanDestination,
  today: string,
): ResultsView | null {
  const delivered = lastDeliveredAt(destination);
  const results = destination.results;
  const liveOn =
    results?.liveOn ?? (delivered ? localDate(delivered) : undefined);
  if (!liveOn) return null;
  const following = !results?.stopped;
  const { due, next } = readsDue(results, liveOn, today);
  const reads = ReadKey.options.map((key) => {
    const read = results?.reads[key] ?? null;
    const window = readWindow(key, liveOn);
    return {
      key,
      label: READ_LABELS[key],
      read,
      window,
      offWindow:
        read !== null && (read.from !== window.from || read.to !== window.to),
      dueOn: dueOn(key, liveOn),
      due: due.some((d) => d.key === key),
    };
  });
  const before = results?.reads.before;
  const against = results?.reads.day30
    ? "day30"
    : results?.reads.day14
      ? "day14"
      : null;
  const after = against ? results?.reads[against] : undefined;
  const compared = before && after ? compareReads(before, after) : null;
  return {
    listingUrl: destination.listingUrl ?? null,
    listingId: destination.listingUrl
      ? etsyListingId(destination.listingUrl)
      : null,
    deliveredOn: delivered ? localDate(delivered) : null,
    liveOn,
    liveOnSet: results?.liveOn !== undefined,
    following,
    reads,
    comparison:
      compared && against
        ? { against, ...compared, line: comparisonLine(compared) }
        : null,
    changed: changedFrames(destination),
    next: next ? { key: next.key, dueOn: next.dueOn } : null,
  };
}

// "2026-11-10" -> "Nov 10".
export const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

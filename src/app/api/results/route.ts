import { localDate } from "@/lib/results-view";
import { apiJson, authorize } from "@/server/http-api";
import { followedListings } from "@/server/listing-results";

// GET /api/results — every listing the maker follows (a delivered sale
// destination), with the reads due today and the next one to come, for an
// agent or a scheduled job that reads the shop's stats and sends the numbers
// back (PUT /api/projects/:id/results/:destinationId/:read). Each read names
// its window; `comparison` is before against the latest after, in words.
export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const today = localDate();
  const listings = await followedListings(today);
  return apiJson({
    today,
    listings: listings
      .filter((l) => l.view.following)
      .map(({ view, ...l }) => ({
        ...l,
        listingUrl: view.listingUrl,
        listingId: view.listingId,
        liveOn: view.liveOn,
        due: view.reads
          .filter((r) => r.due)
          .map((r) => ({ read: r.key, window: r.window, dueOn: r.dueOn })),
        next: view.next
          ? { read: view.next.key, dueOn: view.next.dueOn }
          : null,
        reads: Object.fromEntries(
          view.reads.flatMap((r) => (r.read ? [[r.key, r.read]] : [])),
        ),
        comparison: view.comparison?.line ?? null,
        changed: view.changed.map((f) => f.label),
      })),
  });
}

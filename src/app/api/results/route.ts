import { localDate } from "@/lib/results-view";
import { tokenRoute } from "@/server/guarded";
import { apiJson } from "@/server/http-api";
import { followedListings, followedView } from "@/server/listing-results";

// GET /api/results — every listing the maker follows (a delivered sale
// destination), with the reads due today and the next one to come, for an
// agent or a scheduled job that reads the shop's stats and sends the numbers
// back (PUT /api/projects/:id/results/:destinationId/:read). Each read names
// its window; `comparison` is before against the latest after, in words.
export const GET = tokenRoute(async ({ maker }, _request: Request) => {
  const today = localDate();
  return apiJson({
    today,
    listings: followedView(await followedListings(maker, today)),
  });
});

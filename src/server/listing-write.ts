import { type ListingText, listingDraft, withCopy } from "@/domain/listing";
import type { ProviderId } from "@/domain/model-defaults";
import type { RanOn } from "@/domain/model-routing";
import { CATALOG } from "@/lib/recipes";
import { loadProjectBoard, setListing } from "@/server/project-repository";
import { type Degraded, writeListing } from "@/server/text-calls";

// "Write it with the text model" for one destination of a planned project:
// the board's action and the write_listing tool run it the same way.

// The destination's listing as it stands, when it takes listing text.
export async function listingTarget(projectId: string, destinationId: string) {
  const loaded = await loadProjectBoard(projectId);
  const plan = loaded?.board.plan?.destinations.find(
    (d) => d.destinationId === destinationId,
  );
  const destination = CATALOG.destinations.find((d) => d.id === destinationId);
  if (!loaded?.product || !plan || !destination?.text) return null;
  return {
    product: loaded.product,
    destination,
    rules: destination.text,
    current: plan.listing ?? listingDraft(loaded.product, destination.text),
    saved: plan.listing !== undefined,
    brief: plan.brief,
  };
}

// The deep route (or the model the degraded notice offers) rewrites the
// listing's prose, under the cap. Only the fields the maker has not written
// are replaced; the result is saved and checked like the draft.
export async function writeProjectListing(
  projectId: string,
  destinationId: string,
  model?: { provider: ProviderId; model: string },
): Promise<
  | { error: string }
  | { degraded: Degraded | undefined }
  | { listing: ListingText; ranOn?: RanOn }
> {
  const target = await listingTarget(projectId, destinationId);
  if (!target) return { error: "This destination has no listing text." };
  const result = await writeListing(
    {
      channel: target.destination.name,
      product: target.product,
      rules: target.rules,
      draft: target.current,
    },
    model,
    projectId,
  );
  if (!result.copy) return { degraded: result.degraded };
  const listing = withCopy(target.current, result.copy);
  try {
    await setListing(projectId, destinationId, listing);
  } catch (error) {
    return { error: (error as Error).message };
  }
  return result.ranOn ? { listing, ranOn: result.ranOn } : { listing };
}

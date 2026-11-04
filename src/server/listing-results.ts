import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ListingRead, type ReadKey } from "@/domain/listing-results";
import { ProjectPlan, withRead } from "@/domain/plan";
import { assertDatabaseUrl, db } from "@/lib/db";
import { CATALOG } from "@/lib/recipes";
import { localDate, type ResultsView, resultsView } from "@/lib/results-view";
import { noteRead } from "@/server/lessons";
import { getCurrentMaker } from "@/server/maker-repository";
import { changePlan, loadProjectBoard } from "@/server/project-repository";
import { resultsConnector } from "@/server/shop-connector";

// The results loop's server side: a read saved (typed on the board, sent by an
// agent through the API, or read from the shop connector), and the listings a
// maker follows, with what is due.

export class ResultsRefusal extends Error {
  readonly name = "ResultsRefusal";
}

// Only a sale destination has a listing whose numbers move.
export function saleDestination(destinationId: string) {
  const destination = CATALOG.destinations.find((d) => d.id === destinationId);
  if (destination?.kind !== "sale") {
    throw new ResultsRefusal(
      `"${destinationId}" is not a sale destination: only a listing has results.`,
    );
  }
  return destination;
}

// A read as typed or sent: numbers, and optionally its window, source and
// day; what is left out is the read's own window, today, and the source the
// caller names.
export const ReadInput = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  visits: z.unknown().optional(),
  views: z.unknown().optional(),
  favourites: z.unknown().optional(),
  orders: z.unknown().optional(),
  searchVisits: z.unknown().optional(),
  revenue: z.unknown().optional(),
  source: z.string().optional(),
  readOn: z.iso.date().optional(),
});
export type ReadInput = z.infer<typeof ReadInput>;

// What is wrong with a read, in words ("Visits must be a whole number").
export function readError(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue.path[0];
  if (issue.code === "custom") {
    return `${issue.message[0].toUpperCase()}${issue.message.slice(1)}.`;
  }
  if (field === "from" || field === "to" || field === "readOn") {
    return `The ${field === "readOn" ? "day it was read" : "window"} needs dates (YYYY-MM-DD).`;
  }
  if (field === "source") return "Name where the numbers come from.";
  if (field === "revenue") return "Revenue must be an amount of 0 or more.";
  if (typeof field === "string") {
    const name = `${field[0].toUpperCase()}${field.slice(1)}`.replace(
      "SearchVisits",
      "Visits from search",
    );
    return `${name} must be a whole number of 0 or more.`;
  }
  return "The read could not be kept.";
}

// Save one read of a delivered sale destination; its window defaults to the
// read's own (the 30 days before the photos went up, or the first 14 or 30
// after).
export async function saveRead(input: {
  projectId: string;
  destinationId: string;
  key: ReadKey;
  read: ReadInput;
  source: string;
  today?: string;
}): Promise<ListingRead> {
  saleDestination(input.destinationId);
  const today = input.today ?? localDate();
  let saved: ListingRead | undefined;
  await changePlan(input.projectId, (plan) => {
    const destination = plan.destinations.find(
      (d) => d.destinationId === input.destinationId,
    );
    if (!destination) {
      throw new ResultsRefusal(
        `"${input.destinationId}" is not a destination of this project.`,
      );
    }
    const view = resultsView(destination, today);
    if (!view) {
      throw new ResultsRefusal(
        "Set the day the photos went up first (or deliver it): the reads count from it.",
      );
    }
    const window = view.reads.find((r) => r.key === input.key)?.window;
    const parsed = ListingRead.safeParse({
      ...input.read,
      from: input.read.from ?? window?.from,
      to: input.read.to ?? window?.to,
      source: input.read.source?.trim() || input.source,
      readOn: input.read.readOn ?? today,
    });
    if (!parsed.success) throw new ResultsRefusal(readError(parsed.error));
    saved = parsed.data;
    return withRead(plan, input.destinationId, input.key, parsed.data);
  });
  if (!saved) throw new Error("the read was not saved");
  // An after-read may say which frames moved the numbers: a lesson.
  if (input.key !== "before") {
    await noteRead(input.projectId, input.destinationId);
  }
  return saved;
}

// Read one window from the shop connector and keep it. Refused without a
// connector or a listing address; nothing is paid. Numbers the shop does not
// give (Etsy's API has no visits) stay as typed for the same window.
export async function readFromShop(input: {
  projectId: string;
  destinationId: string;
  key: ReadKey;
  today?: string;
}): Promise<ListingRead> {
  saleDestination(input.destinationId);
  const shop = await resultsConnector();
  if (!shop) {
    throw new ResultsRefusal(
      "No shop is connected: type the numbers from your shop's stats.",
    );
  }
  const today = input.today ?? localDate();
  const loaded = await loadProjectBoard(input.projectId);
  const destination = loaded?.board.plan?.destinations.find(
    (d) => d.destinationId === input.destinationId,
  );
  const view = destination ? resultsView(destination, today) : null;
  if (!view) {
    throw new ResultsRefusal(
      "Set the day the photos went up first (or deliver it): the reads count from it.",
    );
  }
  if (!view.listingUrl) {
    throw new ResultsRefusal("Add the listing's address first.");
  }
  const read = view.reads.find((r) => r.key === input.key);
  if (!read || read.window.to >= today) {
    throw new ResultsRefusal(
      `${read?.label ?? "This read"} can be read from ${read?.dueOn ?? "later"}, once its days have passed.`,
    );
  }
  const numbers = await shop.readListing(view.listingUrl, read.window);
  const typed =
    read.read &&
    read.read.from === read.window.from &&
    read.read.to === read.window.to
      ? read.read
      : null;
  const kept = typed
    ? Object.fromEntries(
        (
          [
            "visits",
            "views",
            "favourites",
            "orders",
            "revenue",
            "searchVisits",
          ] as const
        ).flatMap((m) =>
          typed[m] !== undefined && numbers[m] === undefined
            ? [[m, typed[m]]]
            : [],
        ),
      )
    : {};
  const merged = Object.keys(kept).length > 0;
  return saveRead({
    projectId: input.projectId,
    destinationId: input.destinationId,
    key: input.key,
    read: { ...read.window, ...kept, ...numbers },
    source: merged ? `${shop.label} and typed` : shop.label,
    today,
  });
}

export interface FollowedListing {
  projectId: string;
  projectName: string;
  productName: string | null;
  family: string | null;
  destinationId: string;
  destinationName: string;
  view: ResultsView;
}

// Every delivered sale destination of the maker's projects, followed or not,
// newest project first.
export async function followedListings(
  today = localDate(),
): Promise<FollowedListing[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.project.findMany({
    where: { makerId: maker.id, plan: { not: Prisma.DbNull } },
    select: {
      id: true,
      name: true,
      plan: true,
      products: {
        orderBy: { position: "asc" },
        take: 1,
        select: { product: { select: { name: true, spec: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.flatMap((row) => {
    const plan = ProjectPlan.safeParse(row.plan);
    if (!plan.success) return [];
    const product = row.products[0]?.product;
    const family = (product?.spec as { family?: unknown } | null)?.family;
    return plan.data.destinations.flatMap((d) => {
      const destination = CATALOG.destinations.find(
        (c) => c.id === d.destinationId,
      );
      if (destination?.kind !== "sale") return [];
      const view = resultsView(d, today);
      return view
        ? [
            {
              projectId: row.id,
              projectName: row.name,
              productName: product?.name ?? null,
              family: typeof family === "string" ? family : null,
              destinationId: d.destinationId,
              destinationName: destination.name,
              view,
            },
          ]
        : [];
    });
  });
}

// At delivery, the before read from the shop connector, when there is one,
// the listing's address is known and no before read was taken. It never
// fails the delivery: the board asks for the numbers instead.
export async function readBeforeAtDelivery(
  projectId: string,
  destinationId: string,
): Promise<void> {
  const destination = CATALOG.destinations.find((d) => d.id === destinationId);
  if (destination?.kind !== "sale" || !(await resultsConnector())) return;
  try {
    const loaded = await loadProjectBoard(projectId);
    const plan = loaded?.board.plan?.destinations.find(
      (d) => d.destinationId === destinationId,
    );
    if (!plan?.listingUrl || plan.results?.reads.before) return;
    await readFromShop({ projectId, destinationId, key: "before" });
  } catch (error) {
    console.warn("[kiln results] no before read at delivery", error);
  }
}

// The listings the maker follows, as an agent or a scheduled job reads them
// (GET /api/results, the list_results tool): the reads due today and the next
// one to come, each read by its window; `comparison` is before against the
// latest after, in words.
export function followedView(
  listings: Awaited<ReturnType<typeof followedListings>>,
) {
  return listings
    .filter((l) => l.view.following)
    .map(({ view, ...l }) => ({
      ...l,
      listingUrl: view.listingUrl,
      listingId: view.listingId,
      liveOn: view.liveOn,
      due: view.reads
        .filter((r) => r.due)
        .map((r) => ({ read: r.key, window: r.window, dueOn: r.dueOn })),
      next: view.next ? { read: view.next.key, dueOn: view.next.dueOn } : null,
      reads: Object.fromEntries(
        view.reads.flatMap((r) => (r.read ? [[r.key, r.read]] : [])),
      ),
      comparison: view.comparison?.line ?? null,
      changed: view.changed.map((f) => f.label),
    }));
}

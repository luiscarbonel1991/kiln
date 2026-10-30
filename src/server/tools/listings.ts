import { z } from "zod";
import { ReadKey } from "@/domain/listing-results";
import { isEmptyBrief, MarketBrief } from "@/domain/market-brief";
import { RANK_BY, RANK_WINDOWS, SHOP_RANK_BY } from "@/domain/shop-ranking";
import { localDate } from "@/lib/results-view";
import {
  followedListings,
  followedView,
  ReadInput,
  ResultsRefusal,
  saveRead,
} from "@/server/listing-results";
import { setBrief } from "@/server/project-repository";
import {
  findShops,
  shopFavourites,
  watchedShops,
  yourBestSellers,
} from "@/server/shop-ranking";
import { defineTool, ToolRefusal } from "@/server/tools/registry";

// Selling as tools: a destination's market brief, the listings' results, and
// the shop's numbers on Etsy (read-only; Kiln never publishes). The shop
// tools read Etsy's API for the connected shop, or public shops by id; no page
// is ever scraped.

const Where = {
  project: z.string().min(1).describe("The project's Kiln id."),
  destination: z.string().min(1).describe('The sale destination ("etsy").'),
};

// A write the project refused, in words.
function refused(error: unknown): never {
  if (error instanceof Error && error.message === "project not found") {
    throw new ToolRefusal("No project of yours has that id.");
  }
  if (error instanceof ResultsRefusal) throw new ToolRefusal(error.message);
  throw error;
}

export const saveBriefTool = defineTool({
  name: "save_brief",
  title: "Save a market brief",
  description:
    "Save a destination's market brief, as the board's Market brief does: the searches the listing aims at, the first the one it leads with (term, monthly searches, results, conversion, price band, source, readOn), and notes about page one. It replaces the brief there; an empty one clears it. The listing text and scenes read it.",
  input: z.object({ ...Where, brief: MarketBrief }),
  hints: { idempotent: true },
  run: async ({ project, destination, brief }) => {
    await setBrief(
      project,
      destination,
      isEmptyBrief(brief) ? undefined : brief,
    ).catch(refused);
    return {
      data: {
        project,
        destination,
        searches: brief.searches.length,
        notes: brief.notes.length,
      },
    };
  },
});

export const listResultsTool = defineTool({
  name: "list_results",
  title: "List the listings' results",
  description:
    "Every listing the maker follows (a delivered sale destination): its address, the reads due today and the next one (before, day14, day30, each with its window), the reads kept, before against the latest after in words, and what changed on the listing.",
  input: z.object({}),
  hints: { readOnly: true },
  run: async () => {
    const today = localDate();
    return {
      data: { today, listings: followedView(await followedListings(today)) },
    };
  },
});

export const saveReadTool = defineTool({
  name: "save_read",
  title: "Save a listing's read",
  description:
    "Keep one read of a listing's numbers, as Results does: visits, views, favourites, orders and searchVisits are whole counts, revenue an amount; from and to its window (YYYY-MM-DD, default the read's own) and readOn the day it was read. It replaces a read taken before.",
  input: z.object({
    ...Where,
    read: ReadKey.describe("before, day14 or day30."),
    numbers: ReadInput,
  }),
  hints: { idempotent: true },
  run: async ({ project, destination, read, numbers }) => {
    const saved = await saveRead({
      projectId: project,
      destinationId: destination,
      key: read,
      read: numbers,
      source: "MCP",
    }).catch(refused);
    return { data: { project, destination, read: saved } };
  },
});

export const bestSellersTool = defineTool({
  name: "best_sellers",
  title: "The shop's best sellers",
  description:
    "The connected shop's listings over the last 30, 90 or 365 days, ranked by orders, units or revenue, with the Kiln project each belongs to: the ones worth a refresh first. Read from Etsy's API.",
  input: z.object({
    days: z
      .union(RANK_WINDOWS.map((d) => z.literal(d)))
      .default(90)
      .describe("30, 90 or 365."),
    by: z.enum(RANK_BY).default("orders"),
  }),
  hints: { readOnly: true, openWorld: true },
  run: async ({ days, by }) => {
    const view = await yourBestSellers(days, { by });
    if (!view) {
      throw new ToolRefusal(
        "No shop is connected: the maker connects one in Shops.",
      );
    }
    return { data: { ...view } };
  },
});

export const watchedShopsTool = defineTool({
  name: "watched_shops",
  title: "The shops the maker compares with",
  description:
    "The shops the maker compares theirs with, theirs among them, ranked by the past year's reviews (recent) or lifetime sales: the numbers Etsy gives about another shop.",
  input: z.object({ by: z.enum(SHOP_RANK_BY).default("recent") }),
  hints: { readOnly: true, openWorld: true },
  run: async ({ by }) => {
    const view = await watchedShops({ by });
    if (!view)
      throw new ToolRefusal("Kiln has no Etsy key to read shops with.");
    return { data: { ...view } };
  },
});

export const findShopsTool = defineTool({
  name: "find_shops",
  title: "Find shops on Etsy",
  description:
    "Shops Etsy finds by a name, with their public numbers (sales, favourites, the past year's reviews, active listings), to pick one to compare with.",
  input: z.object({ name: z.string().trim().min(2).max(80) }),
  hints: { readOnly: true, openWorld: true },
  run: async ({ name }) => ({ data: { shops: await findShops(name) } }),
});

export const shopFavouritesTool = defineTool({
  name: "shop_favourites",
  title: "A shop's most favoured listings",
  description:
    "A shop's active listings by favourites, the most first, with price and photo: what Etsy gives in place of another shop's sales per listing.",
  input: z.object({
    shop: z
      .string()
      .regex(/^\d+$/, "A shop's Etsy id is a number.")
      .describe("The shop's Etsy id."),
  }),
  hints: { readOnly: true, openWorld: true },
  run: async ({ shop }) => ({
    data: { shop, ...(await shopFavourites(shop)) },
  }),
});

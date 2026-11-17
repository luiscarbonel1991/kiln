"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { ReadKey } from "@/domain/listing-results";
import { ListingUrl } from "@/domain/live-listing";
import {
  withFollowing,
  withListingUrl,
  withLiveOn,
  withRead,
} from "@/domain/plan";
import { makerAction } from "@/server/guarded";
import {
  ReadInput,
  readFromShop,
  saleDestination,
  saveRead,
} from "@/server/listing-results";
import { changePlan } from "@/server/project-repository";

// The board's results panel: the listing's address, the day its photos went
// up, each read (typed, or from the shop connector) and whether the listing
// is still followed. Server Functions are POST-reachable: Zod is the trust
// boundary, and every write is scoped to the current maker.

const Where = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
});

type Result = { error: string } | undefined;

async function run(change: () => Promise<unknown>, fallback: string) {
  try {
    await change();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : fallback,
    };
  }
  refresh();
}

export const saveReadAction = makerAction(
  async (maker, input: unknown): Promise<Result> => {
    const parsed = Where.extend({
      key: ReadKey,
      read: ReadInput.nullable(),
    }).safeParse(input);
    if (!parsed.success) return { error: "The read could not be read." };
    const { projectId, destinationId, key, read } = parsed.data;
    return run(async () => {
      saleDestination(destinationId);
      if (read === null) {
        await changePlan(maker, projectId, (plan) =>
          withRead(plan, destinationId, key, null),
        );
        return;
      }
      await saveRead(maker, {
        projectId,
        destinationId,
        key,
        read,
        source: "typed",
      });
    }, "Could not keep the read.");
  },
);

export const readFromShopAction = makerAction(
  async (maker, input: unknown): Promise<Result> => {
    const parsed = Where.extend({ key: ReadKey }).safeParse(input);
    if (!parsed.success) return { error: "The read could not be read." };
    return run(
      () => readFromShop(maker, parsed.data),
      "The shop could not be read.",
    );
  },
);

export const setListingUrlAction = makerAction(
  async (maker, input: unknown): Promise<Result> => {
    const parsed = Where.extend({
      url: z.string().trim().nullable(),
    }).safeParse(input);
    if (!parsed.success) return { error: "The address could not be read." };
    const { projectId, destinationId, url } = parsed.data;
    const address = url ? ListingUrl.safeParse(url) : null;
    if (address && !address.success) {
      return { error: address.error.issues[0].message };
    }
    return run(async () => {
      saleDestination(destinationId);
      await changePlan(maker, projectId, (plan) =>
        withListingUrl(plan, destinationId, address?.data ?? null),
      );
    }, "Could not keep the address.");
  },
);

export const setLiveOnAction = makerAction(
  async (maker, input: unknown): Promise<Result> => {
    const parsed = Where.extend({ liveOn: z.iso.date().nullable() }).safeParse(
      input,
    );
    if (!parsed.success) return { error: "Pick a day (YYYY-MM-DD)." };
    const { projectId, destinationId, liveOn } = parsed.data;
    return run(async () => {
      saleDestination(destinationId);
      await changePlan(maker, projectId, (plan) =>
        withLiveOn(plan, destinationId, liveOn),
      );
    }, "Could not keep the day.");
  },
);

export const setFollowingAction = makerAction(
  async (maker, input: unknown): Promise<Result> => {
    const parsed = Where.extend({ following: z.boolean() }).safeParse(input);
    if (!parsed.success) return { error: "Could not read that." };
    const { projectId, destinationId, following } = parsed.data;
    return run(async () => {
      saleDestination(destinationId);
      await changePlan(maker, projectId, (plan) =>
        withFollowing(plan, destinationId, following),
      );
    }, "Could not change it.");
  },
);

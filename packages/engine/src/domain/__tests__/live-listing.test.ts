import { describe, expect, it } from "vitest";
import { etsyListingId, ListingUrl } from "@/domain/live-listing";
import {
  approveSlot,
  deliveryBlockers,
  generableCardIds,
  moveSlot,
  type PlanDestination,
  planCounts,
  planFromListing,
  replacementFrames,
  replan,
  slotState,
  withDelivered,
} from "@/domain/plan";
import type { Product } from "@/domain/product";
import { SEED_DESTINATIONS, SEED_SHOT_LISTS } from "@/domain/seed";
import { ShotList } from "@/domain/shot-list";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const catalog = {
  destinations: SEED_DESTINATIONS,
  shotLists: SEED_SHOT_LISTS,
};
const URL = "https://www.etsy.com/listing/4413933723/engraved-family-board";
const photo = (n: number, replaceWith?: string) => ({
  url: `https://storage.test/listings/p${n}.jpg`,
  aspect: n === 2 ? "4:5" : "4:3",
  ...(replaceWith ? { replaceWith } : {}),
});

// Five live photos: the first replaced by the hero, the fourth by Size &
// spec, the rest kept.
const plan = planFromListing({
  product: CUTTING_BOARD,
  destinationId: "etsy",
  catalog,
  listingUrl: URL,
  photos: [photo(1, "hero"), photo(2), photo(3), photo(4, "size"), photo(5)],
});
const etsy = plan.destinations[0];

describe("a live listing's address", () => {
  it("reads Etsy's listing id from the listing's address", () => {
    expect(etsyListingId(URL)).toBe("4413933723");
    expect(etsyListingId("https://etsy.com/de/listing/123456/name")).toBe(
      "123456",
    );
    expect(etsyListingId("https://www.etsy.com/listing/987")).toBe("987");
    expect(etsyListingId("https://shop.example.com/listing/987")).toBeNull();
    expect(etsyListingId("https://www.etsy.com/shop/maker")).toBeNull();
    expect(etsyListingId("not an address")).toBeNull();
  });

  it("takes an https address only", () => {
    expect(ListingUrl.safeParse(URL).success).toBe(true);
    expect(ListingUrl.safeParse("http://www.etsy.com/listing/1").success).toBe(
      false,
    );
    expect(ListingUrl.safeParse("javascript:alert(1)").success).toBe(false);
  });
});

describe("planFromListing", () => {
  it("keeps the live photos in their order and puts each new frame in the place of the photo it replaces", () => {
    expect(etsy.destinationId).toBe("etsy");
    expect(etsy.listingUrl).toBe(URL);
    expect(etsy.slots.map((s) => [s.key, s.fill])).toEqual([
      ["hero", "scene"],
      ["live-2", "photo"],
      ["live-3", "photo"],
      ["size", "exact"],
      ["live-5", "photo"],
    ]);
    expect(etsy.slots[0].before).toEqual({
      url: "https://storage.test/listings/p1.jpg",
      aspect: "4:3",
    });
    // The frame keeps its own knobs; a kept photo keeps its proportions.
    expect(etsy.slots[0].knobs).toBeDefined();
    expect(etsy.slots[1]).toMatchObject({
      label: "Your photo",
      aspect: "4:5",
      photo: "https://storage.test/listings/p2.jpg",
    });
  });

  it("offers the shot list's frames this product can have, never the video", () => {
    const keys = replacementFrames(CUTTING_BOARD, "etsy", catalog).map(
      (s) => s.key,
    );
    expect(keys).toContain("hero");
    expect(keys).toContain("personalize");
    expect(keys).not.toContain("video");
    const plain: Product = { ...CUTTING_BOARD, wording: [] };
    expect(
      replacementFrames(plain, "etsy", catalog).map((s) => s.key),
    ).not.toContain("personalize");
  });

  it("refuses a frame twice, a frame the product cannot have, nothing to replace, too many photos and a destination that is not a sale", () => {
    const make = (
      photos: ReturnType<typeof photo>[],
      over: { product?: Product; destinationId?: string } = {},
    ) =>
      planFromListing({
        product: over.product ?? CUTTING_BOARD,
        destinationId: over.destinationId ?? "etsy",
        catalog,
        photos,
      });
    expect(() => make([photo(1, "hero"), photo(2, "hero")])).toThrow(
      /one photo only/,
    );
    expect(() =>
      make([photo(1, "personalize")], {
        product: { ...CUTTING_BOARD, wording: [] },
      }),
    ).toThrow(/not a frame this product can have/);
    expect(() => make([photo(1), photo(2)])).toThrow(/mark a photo to replace/);
    expect(() => make([])).toThrow(/add the listing's photos/);
    expect(() =>
      make(
        Array.from({ length: 21 }, (_, i) =>
          photo(i + 1, i === 0 ? "hero" : undefined),
        ),
      ),
    ).toThrow(/at most 20/);
    expect(() =>
      make([photo(1, "hero")], { destinationId: "instagram" }),
    ).toThrow(/not a sale destination/);
  });

  it("a shot list never holds a photo slot", () => {
    expect(() =>
      ShotList.parse({
        id: "x",
        name: "X",
        destinationId: null,
        slots: [
          {
            key: "mine",
            label: "Mine",
            purpose: "p",
            fill: "photo",
          },
        ],
      }),
    ).toThrow(/a photo slot is the maker's own photo/);
  });
});

describe("the maker's own photo across the plan", () => {
  const ref = (slotKey: string) => ({ destinationId: "etsy", slotKey });

  it("is ready as it is: never generated, never approved, delivered as it is", () => {
    expect(slotState(etsy.slots[1])).toEqual({ state: "kept", failed: false });
    expect(generableCardIds(plan)).toEqual(["etsy.hero"]);
    expect(() =>
      approveSlot(plan, ref("live-2"), {
        status: "done",
        outputs: ["x.png"],
      }),
    ).toThrow(/needs no approval/);
    expect(deliveryBlockers(etsy, () => undefined).notReady).toEqual([
      "Marketplace hero",
    ]);
    expect(planCounts(plan)).toEqual({
      exact: 1,
      scene: 1,
      video: 0,
      photo: 3,
      off: 0,
    });
    const delivered = withDelivered(
      plan,
      "etsy",
      [{ key: "live-2" }, { key: "size" }],
      "2026-10-26T12:00:00Z",
    );
    const slots = delivered.destinations[0].slots;
    expect(slots[1].deliveredAt).toBe("2026-10-26T12:00:00Z");
    expect(slotState(slots[1]).state).toBe("delivered");
  });

  it("moves like any photo: Make photo 1", () => {
    const moved = moveSlot(plan, ref("live-3"), "first");
    expect(moved.destinations[0].slots.map((s) => s.key)).toEqual([
      "live-3",
      "hero",
      "live-2",
      "size",
      "live-5",
    ]);
  });
});

describe("replan on a plan from a live listing", () => {
  it("never adds frames the maker did not choose", () => {
    const { plan: next, changes } = replan(
      plan,
      { ...CUTTING_BOARD, colours: [...CUTTING_BOARD.colours] },
      SEED_SHOT_LISTS,
    );
    expect(changes).toEqual([]);
    expect(next.destinations[0].slots.map((s) => s.key)).toEqual(
      etsy.slots.map((s) => s.key),
    );
  });

  it("gives a replaced photo its place back when its frame no longer applies", () => {
    const withLines = planFromListing({
      product: CUTTING_BOARD,
      destinationId: "etsy",
      catalog,
      photos: [photo(1, "hero"), photo(2, "personalize")],
    });
    const { plan: next, changes } = replan(
      withLines,
      { ...CUTTING_BOARD, wording: [] },
      SEED_SHOT_LISTS,
    );
    expect(changes).toEqual([
      {
        destinationId: "etsy",
        key: "personalize",
        label: "How to personalize",
        change: "removes",
      },
    ]);
    const slots: PlanDestination["slots"] = next.destinations[0].slots;
    expect(slots.map((s) => [s.key, s.fill])).toEqual([
      ["hero", "scene"],
      ["live-personalize", "photo"],
    ]);
    expect(slots[1]).toMatchObject({
      photo: "https://storage.test/listings/p2.jpg",
      aspect: "4:5",
    });
  });
});

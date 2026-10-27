import { describe, expect, it } from "vitest";
import {
  heroKey,
  heroProposal,
  heroSettingsOf,
  withHeroSettings,
} from "@/domain/hero-setting";
import { planProject } from "@/domain/plan";
import type { Product } from "@/domain/product";
import { SEED_DESTINATIONS, SEED_SHOT_LISTS } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const catalog = { destinations: SEED_DESTINATIONS, shotLists: SEED_SHOT_LISTS };
const at = (...places: string[]): Product => ({
  ...CUTTING_BOARD,
  family: "Home",
  useContexts: places,
});

describe("heroProposal", () => {
  it("proposes the maker's own choice for the family on that destination first", () => {
    expect(
      heroProposal(at("a kitchen counter"), "etsy", {
        [heroKey("etsy", "home")]: "place",
      }),
    ).toEqual({ setting: "place", source: "remembered" });
    // Another destination or family is not this choice.
    expect(
      heroProposal(at("a kitchen counter"), "etsy", {
        [heroKey("shopify", "Home")]: "place",
        [heroKey("etsy", "Kitchen")]: "place",
      }).setting,
    ).toBe("sweep");
  });

  it("proposes it in its place when it stays where it is used, else a plain backdrop", () => {
    expect(heroProposal(at("beside a front door"), "etsy", {})).toEqual({
      setting: "place",
      source: "placed",
      place: "beside a front door",
    });
    expect(heroProposal(at("on an office wall"), "etsy", {}).setting).toBe(
      "place",
    );
    // On show rather than mounted: a desk, a reception counter, a shelf.
    for (const place of [
      "front edge of an office desk, beside a laptop",
      "a reception counter, facing the visitor",
      "a bookshelf in a reading nook",
    ]) {
      expect(heroProposal(at(place), "etsy", {}).setting).toBe("place");
    }
    expect(heroProposal(at("a kitchen counter"), "etsy", {})).toEqual({
      setting: "sweep",
      source: "default",
    });
    expect(heroProposal(at(), "etsy", {}).source).toBe("default");
    // Words that only contain a mounting word do not count.
    expect(heroProposal(at("an outdoor table"), "etsy", {}).setting).toBe(
      "sweep",
    );
  });
});

describe("withHeroSettings", () => {
  const plan = planProject({
    product: CUTTING_BOARD,
    type: "launch",
    destinationIds: ["etsy", "instagram"],
    catalog,
  });

  it("sets the hero of each destination that offers the setting, and nothing else", () => {
    expect(heroSettingsOf(plan)).toEqual([
      { destinationId: "etsy", setting: "sweep" },
    ]);
    const next = withHeroSettings(plan, (id) =>
      id === "etsy" ? "place" : "place",
    );
    expect(heroSettingsOf(next)).toEqual([
      { destinationId: "etsy", setting: "place" },
    ]);
    const hero = next.destinations[0].slots.find((s) => s.key === "hero");
    expect(hero?.knobs).toMatchObject({ setting: "place", distance: "close" });
    expect(next.destinations[1]).toEqual(plan.destinations[1]);
    expect(withHeroSettings(plan, () => undefined)).toEqual(plan);
  });
});

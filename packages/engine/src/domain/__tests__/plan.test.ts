import { describe, expect, it } from "vitest";
import { DestinationProfile } from "@/domain/destination";
import {
  approveSlot,
  destinationsFor,
  parseSlotRecipeId,
  planCounts,
  planProject,
  slotCardId,
  slotRecipeId,
  slotState,
  unapproveSlot,
} from "@/domain/plan";
import { ShotList } from "@/domain/shot-list";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const shop = DestinationProfile.parse({
  id: "shop",
  name: "Shop",
  kind: "sale",
  formats: [{ key: "square", label: "Square", aspect: "1:1" }],
  rules: { textOnImage: "forbidden", negative: [] },
  delivery: { mode: "export" },
});
const social = DestinationProfile.parse({
  ...shop,
  id: "social",
  name: "Social",
  kind: "content",
});

const shopKit = ShotList.parse({
  id: "shop-kit",
  name: "Shop kit",
  destinationId: "shop",
  projectTypes: ["listing-kit", "launch"],
  slots: [
    { key: "hero", label: "Hero", purpose: "Win the click.", aspect: "1:1" },
    {
      key: "colours",
      label: "Colours",
      purpose: "Every colour.",
      fill: "exact",
      exact: "colour-grid",
    },
    {
      key: "personalize",
      label: "How to personalize",
      purpose: "What the buyer types.",
      fill: "exact",
      exact: "personalize",
    },
  ],
});
const socialEditorOnly = ShotList.parse({
  id: "social-preset",
  name: "Social preset",
  destinationId: "social",
  slots: [{ key: "hook", label: "Hook", purpose: "Stop the scroll." }],
});
const socialCarousel = ShotList.parse({
  id: "social-carousel",
  name: "Social carousel",
  destinationId: "social",
  projectTypes: ["content", "launch"],
  slots: [{ key: "hook", label: "Hook", purpose: "Stop the scroll." }],
});

const catalog = {
  destinations: [shop, social],
  shotLists: [shopKit, socialEditorOnly, socialCarousel],
};

describe("planProject", () => {
  it("lays out one row per destination with its shot list's slots, in order", () => {
    const plan = planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog,
    });
    expect(plan.destinations.map((d) => d.shotListId)).toEqual([
      "shop-kit",
      "social-carousel",
    ]);
    expect(plan.destinations[0].slots.map((s) => s.key)).toEqual([
      "hero",
      "colours",
      "personalize",
    ]);
    expect(planCounts(plan)).toEqual({ exact: 2, scene: 2 });
  });

  it("skips editor-only presets and offers destinations by project type", () => {
    expect(destinationsFor("listing-kit", catalog.destinations)).toEqual([
      shop,
    ]);
    expect(destinationsFor("content", catalog.destinations)).toEqual([social]);
    expect(destinationsFor("design", catalog.destinations)).toEqual([]);
    expect(() =>
      planProject({
        product: CUTTING_BOARD,
        type: "listing-kit",
        destinationIds: ["social"],
        catalog,
      }),
    ).toThrow(/not offered/);
  });

  it("refuses an empty or unknown destination list and dedupes repeats", () => {
    const base = { product: CUTTING_BOARD, type: "launch" as const, catalog };
    expect(() => planProject({ ...base, destinationIds: [] })).toThrow();
    expect(() => planProject({ ...base, destinationIds: ["nope"] })).toThrow();
    expect(
      planProject({ ...base, destinationIds: ["shop", "shop"] }).destinations,
    ).toHaveLength(1);
  });

  it("leaves out an exact slot with nothing to show for the product", () => {
    const plain = { ...CUTTING_BOARD, wording: [] };
    const plan = planProject({
      product: plain,
      type: "listing-kit",
      destinationIds: ["shop"],
      catalog,
    });
    expect(plan.destinations[0].slots.map((s) => s.key)).toEqual([
      "hero",
      "colours",
    ]);
  });
});

describe("slot ids", () => {
  it("are unique per destination and round-trip the recipe id", () => {
    expect(slotCardId("shop", "hero")).not.toBe(slotCardId("social", "hero"));
    expect(parseSlotRecipeId(slotRecipeId("shop-kit", "shop"))).toEqual({
      shotListId: "shop-kit",
      destinationId: "shop",
    });
    expect(parseSlotRecipeId("recipe-etsy-hero")).toBeNull();
  });
});

describe("slotState", () => {
  const plan = planProject({
    product: CUTTING_BOARD,
    type: "listing-kit",
    destinationIds: ["shop"],
    catalog,
  });
  const [hero, colours] = plan.destinations[0].slots;
  const done = { status: "done" as const, outputs: ["https://x/1.png"] };

  it.each([
    ["no card", undefined, "queued", false],
    ["draft", { status: "draft" as const, outputs: [] }, "queued", false],
    [
      "rendering",
      { status: "rendering" as const, outputs: [] },
      "generating",
      false,
    ],
    ["error", { status: "error" as const, outputs: [] }, "queued", true],
    [
      "done, empty output",
      { status: "done" as const, outputs: [""] },
      "queued",
      true,
    ],
    ["done", done, "to-review", false],
  ])("%s -> %s", (_name, card, state, failed) => {
    expect(slotState(hero, card)).toEqual({ state, failed });
  });

  it("an exact slot is exact, whatever the cards say", () => {
    expect(slotState(colours).state).toBe("exact");
    expect(slotState({ ...colours, deliveredAt: "2026-10-02" }).state).toBe(
      "delivered",
    );
  });

  it("approval holds for the approved output only; a re-roll un-approves", () => {
    const ref = { destinationId: "shop", slotKey: "hero" };
    const approved = approveSlot(plan, ref, done);
    const slot = approved.destinations[0].slots[0];
    expect(slotState(slot, done).state).toBe("approved");
    expect(
      slotState(slot, { status: "done", outputs: ["https://x/2.png"] }).state,
    ).toBe("to-review");
    expect(
      slotState(unapproveSlot(approved, ref).destinations[0].slots[0], done)
        .state,
    ).toBe("to-review");
  });

  it("approveSlot refuses exact slots, unfinished cards and empty outputs", () => {
    const hero = { destinationId: "shop", slotKey: "hero" };
    expect(() =>
      approveSlot(plan, { destinationId: "shop", slotKey: "colours" }, done),
    ).toThrow();
    expect(() =>
      approveSlot(plan, hero, { status: "rendering", outputs: [] }),
    ).toThrow();
    expect(() =>
      approveSlot(plan, hero, { status: "done", outputs: [""] }),
    ).toThrow();
    expect(() => approveSlot(plan, hero, undefined)).toThrow();
    expect(() =>
      approveSlot(plan, { destinationId: "shop", slotKey: "nope" }, done),
    ).toThrow();
  });
});

describe("slotState with the queue", () => {
  const plan = planProject({
    product: CUTTING_BOARD,
    type: "listing-kit",
    destinationIds: ["shop"],
    catalog,
  });
  const [hero] = plan.destinations[0].slots;
  const draft = { status: "draft" as const, outputs: [] };
  const done = { status: "done" as const, outputs: ["https://x/1.png"] };

  it.each([
    [
      "queued, first attempt",
      { status: "queued" as const, attempt: 0 },
      "queued",
    ],
    [
      "running, first attempt",
      { status: "running" as const, attempt: 1 },
      "generating",
    ],
    [
      "queued for its retry",
      { status: "queued" as const, attempt: 1 },
      "retrying",
    ],
    [
      "running its retry",
      { status: "running" as const, attempt: 2 },
      "retrying",
    ],
  ])("%s -> %s, in the batch", (_name, job, state) => {
    expect(slotState(hero, draft, job)).toEqual({
      state,
      failed: false,
      inBatch: true,
    });
  });

  it("a failed job flags a slot without output", () => {
    expect(slotState(hero, draft, { status: "failed", attempt: 2 })).toEqual({
      state: "queued",
      failed: true,
    });
  });

  it("a failed re-roll leaves an approved output approved", () => {
    const approved = approveSlot(
      plan,
      { destinationId: "shop", slotKey: "hero" },
      done,
    ).destinations[0].slots[0];
    expect(
      slotState(approved, done, { status: "failed", attempt: 2 }).state,
    ).toBe("approved");
  });

  it("a done or canceled job defers to the card", () => {
    expect(slotState(hero, done, { status: "done", attempt: 1 }).state).toBe(
      "to-review",
    );
    expect(slotState(hero, draft, { status: "canceled", attempt: 0 })).toEqual({
      state: "queued",
      failed: false,
    });
  });
});

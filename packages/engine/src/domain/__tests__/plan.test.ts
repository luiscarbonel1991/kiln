import { describe, expect, it } from "vitest";
import { DestinationProfile } from "@/domain/destination";
import { listingDraft } from "@/domain/listing";
import { MarketBrief } from "@/domain/market-brief";
import {
  addVideoSlot,
  approveSlot,
  deliveryBlockers,
  destinationsFor,
  generableCardIds,
  moveSlot,
  ProjectPlan,
  parseSlotCardId,
  parseSlotRecipeId,
  planCounts,
  planProject,
  planVideos,
  replan,
  sceneCardIds,
  slotCardId,
  slotRecipeId,
  slotState,
  unapproveSlot,
  versionSource,
  videoSettings,
  withBrief,
  withDelivered,
  withFollowing,
  withListing,
  withListingUrl,
  withLiveOn,
  withRead,
  withSlotOff,
  withSlotPlace,
  withSlotTuning,
  withThreeQuarter,
  withVideoChoice,
} from "@/domain/plan";
import type { Product } from "@/domain/product";
import { SEED_DESTINATIONS, SEED_SHOT_LISTS } from "@/domain/seed";
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
    expect(planCounts(plan)).toEqual({
      exact: 2,
      scene: 2,
      video: 0,
      photo: 0,
      shared: 0,
      off: 0,
    });
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
    // A product sold in one colour has no colour sheet to show.
    const single = planProject({
      product: { ...plain, colours: [CUTTING_BOARD.colours[0]] },
      type: "listing-kit",
      destinationIds: ["shop"],
      catalog,
    });
    expect(single.destinations[0].slots.map((s) => s.key)).toEqual(["hero"]);
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

describe("a slot's tuning", () => {
  const knobbed = ShotList.parse({
    ...shopKit,
    slots: [
      {
        key: "hero",
        label: "Hero",
        purpose: "Win the click.",
        knobs: { camera: "eye", light: "studio" },
      },
      ...shopKit.slots.slice(1),
    ],
  });
  const tuneCatalog = { ...catalog, shotLists: [knobbed, socialCarousel] };
  const start = () =>
    planProject({
      product: CUTTING_BOARD,
      type: "listing-kit",
      destinationIds: ["shop"],
      catalog: tuneCatalog,
    });
  const hero = { destinationId: "shop", slotKey: "hero" };

  it("snapshots the slot's knobs, and keeps what the maker sets", () => {
    const plan = start();
    expect(plan.destinations[0].slots[0].knobs).toEqual({
      camera: "eye",
      light: "studio",
    });
    const tuned = withSlotTuning(plan, hero, { knob: "camera", stop: "above" });
    expect(tuned.destinations[0].slots[0].tuned).toEqual({ camera: "above" });
    const both = withSlotTuning(tuned, hero, { knob: "light", stop: "warm" });
    expect(both.destinations[0].slots[0].tuned).toEqual({
      camera: "above",
      light: "warm",
    });
  });

  it("null returns a knob to its default; nothing tuned leaves no trace", () => {
    const tuned = withSlotTuning(start(), hero, {
      knob: "camera",
      stop: "above",
    });
    const back = withSlotTuning(tuned, hero, { knob: "camera", stop: null });
    expect(back.destinations[0].slots[0]).not.toHaveProperty("tuned");
  });

  it("refuses an exact slot, a slot planned before knobs, and a knob it lacks", () => {
    expect(() =>
      withSlotTuning(
        start(),
        { destinationId: "shop", slotKey: "colours" },
        { knob: "camera", stop: "eye" },
      ),
    ).toThrow("not a scene slot");
    const old = planProject({
      product: CUTTING_BOARD,
      type: "listing-kit",
      destinationIds: ["shop"],
      catalog,
    });
    expect(() =>
      withSlotTuning(old, hero, { knob: "camera", stop: "eye" }),
    ).toThrow("planned before knobs");
    expect(() =>
      withSlotTuning(start(), hero, { knob: "props", stop: "none" }),
    ).toThrow("no props knob");
  });

  it("a saved plan with a stop that no longer exists still parses", () => {
    const plan = withSlotTuning(start(), hero, {
      knob: "camera",
      stop: "above",
    });
    const saved = JSON.parse(JSON.stringify(plan));
    saved.destinations[0].slots[0].tuned.camera = "gone";
    saved.destinations[0].slots[0].knobs.light = "gone";
    const read = ProjectPlan.parse(saved).destinations[0].slots[0];
    expect(read.tuned?.camera).toBeUndefined();
    expect(read.knobs?.light).toBeUndefined();
    expect(read.knobs?.camera).toBe("eye");
  });
});

describe("replan", () => {
  const plain: Product = {
    ...CUTTING_BOARD,
    colours: CUTTING_BOARD.colours.slice(0, 1),
    wording: [],
  };
  const start = (product: Product = plain) =>
    planProject({
      product,
      type: "listing-kit",
      destinationIds: ["shop"],
      catalog,
    });
  const keys = (plan: ProjectPlan) =>
    plan.destinations[0].slots.map((s) => s.key);

  it("adds the frames the new version calls for, where the list puts them", () => {
    const plan = start();
    expect(keys(plan)).toEqual(["hero"]);
    const next = replan(plan, CUTTING_BOARD, catalog.shotLists);
    expect(keys(next.plan)).toEqual(["hero", "colours", "personalize"]);
    expect(next.changes.map((c) => [c.change, c.key])).toEqual([
      ["adds", "colours"],
      ["adds", "personalize"],
    ]);
    expect(replan(next.plan, CUTTING_BOARD, catalog.shotLists).changes).toEqual(
      [],
    );
  });

  it("removes the ones it no longer calls for, keeping the maker's work", () => {
    const card = { status: "done" as const, outputs: ["https://x/1.png"] };
    const plan = approveSlot(
      withSlotOff(
        start(CUTTING_BOARD),
        { destinationId: "shop", slotKey: "colours" },
        true,
      ),
      { destinationId: "shop", slotKey: "hero" },
      card,
    );
    const next = replan(plan, plain, catalog.shotLists);
    expect(keys(next.plan)).toEqual(["hero"]);
    expect(next.plan.destinations[0].slots[0].approvedOutput).toBe(
      "https://x/1.png",
    );
    expect(next.changes.map((c) => [c.change, c.key])).toEqual([
      ["removes", "colours"],
      ["removes", "personalize"],
    ]);
  });

  it("never makes an added frame the first photo", () => {
    const listFirst = ShotList.parse({
      ...shopKit,
      slots: [shopKit.slots[1], shopKit.slots[0], shopKit.slots[2]],
    });
    const plan = planProject({
      product: plain,
      type: "listing-kit",
      destinationIds: ["shop"],
      catalog: { ...catalog, shotLists: [listFirst, socialCarousel] },
    });
    const next = replan(plan, CUTTING_BOARD, [listFirst]);
    expect(keys(next.plan)[0]).toBe("hero");
  });

  it("clears a delivery when the photos renumber, and says so", () => {
    const plan = withDelivered(
      start(),
      "shop",
      [{ key: "hero", approvedOutput: undefined }],
      "2026-10-21T10:00:00Z",
    );
    const hero = plan.destinations[0].slots[0];
    // A scene is delivered only once approved: stamp it as delivered.
    plan.destinations[0].slots[0] = {
      ...hero,
      deliveredAt: "2026-10-21T10:00:00Z",
    };
    const next = replan(plan, CUTTING_BOARD, catalog.shotLists);
    expect(next.redeliver).toEqual(["shop"]);
    expect(next.plan.destinations[0].slots.some((s) => s.deliveredAt)).toBe(
      false,
    );
  });
});

describe("switching slots off", () => {
  const launch = () =>
    planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog,
    });
  const hero = { destinationId: "shop", slotKey: "hero" };

  it("an off slot stays in the plan, reads as off and leaves the counts", () => {
    const plan = withSlotOff(launch(), hero, true);
    const slot = plan.destinations[0].slots[0];
    expect(slot).toMatchObject({ key: "hero", off: true });
    expect(slotState(slot).state).toBe("off");
    expect(planCounts(plan)).toEqual({
      exact: 2,
      scene: 1,
      video: 0,
      photo: 0,
      shared: 0,
      off: 1,
    });
    expect(sceneCardIds(plan)).toEqual(["social.hook"]);
  });

  it("switching back on keeps an approval; an exact slot can be switched off too", () => {
    const card = { status: "done" as const, outputs: ["https://x/1.png"] };
    const approved = approveSlot(launch(), hero, card);
    const back = withSlotOff(withSlotOff(approved, hero, true), hero, false);
    expect(back.destinations[0].slots[0]).not.toHaveProperty("off");
    expect(slotState(back.destinations[0].slots[0], card).state).toBe(
      "approved",
    );
    const colours = withSlotOff(
      launch(),
      { destinationId: "shop", slotKey: "colours" },
      true,
    );
    expect(slotState(colours.destinations[0].slots[1]).state).toBe("off");
  });

  it("an unknown slot is refused", () => {
    expect(() =>
      withSlotOff(launch(), { destinationId: "shop", slotKey: "nope" }, true),
    ).toThrow('no slot "nope"');
  });

  it("slot card ids parse back to their slot", () => {
    expect(parseSlotCardId("etsy.in-use")).toEqual({
      destinationId: "etsy",
      slotKey: "in-use",
    });
    expect(parseSlotCardId("etsy")).toBeNull();
    expect(parseSlotCardId(".gift")).toBeNull();
    expect(parseSlotCardId("etsy.")).toBeNull();
  });
});

describe("delivery", () => {
  const launch = () =>
    planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog,
    });
  const hero = { destinationId: "shop", slotKey: "hero" };
  const card = { status: "done" as const, outputs: ["https://x/1.png"] };

  it("a destination is ready when every slot switched on is exact or approved", () => {
    const plan = launch();
    const shopPlan = () => plan.destinations[0];
    expect(deliveryBlockers(shopPlan(), () => card)).toEqual({
      notReady: ["Hero"],
    });
    const approved = approveSlot(plan, hero, card);
    expect(
      deliveryBlockers(approved.destinations[0], () => card).notReady,
    ).toEqual([]);
    // A slot switched off is not part of the deliverable.
    const off = withSlotOff(plan, hero, true);
    expect(deliveryBlockers(off.destinations[0], () => undefined)).toEqual({
      notReady: [],
    });
    // A re-rolled card is not approved any more.
    expect(
      deliveryBlockers(approved.destinations[0], () => ({
        status: "done" as const,
        outputs: ["https://x/2.png"],
      })).notReady,
    ).toEqual(["Hero"]);
  });

  it("a scene with text on the image is ready once approved: the text is drawn at export", () => {
    const plan = approveSlot(launch(), hero, card);
    const withText = {
      ...plan.destinations[0],
      slots: plan.destinations[0].slots.map((s) =>
        s.key === "hero" ? { ...s, textTemplate: "{product.hook}" } : s,
      ),
    };
    expect(deliveryBlockers(withText, () => card)).toEqual({ notReady: [] });
  });

  it("stamps what was exported; a scene only if its approval did not change", () => {
    const approved = approveSlot(launch(), hero, card);
    const at = "2026-10-06T10:00:00.000Z";
    const stamped = withDelivered(
      approved,
      "shop",
      [{ key: "hero", approvedOutput: "https://x/1.png" }, { key: "colours" }],
      at,
    );
    const [h, colours, personalize] = stamped.destinations[0].slots;
    expect(h.deliveredAt).toBe(at);
    expect(slotState(h, card).state).toBe("delivered");
    expect(colours.deliveredAt).toBe(at);
    expect(personalize.deliveredAt).toBeUndefined();
    // An unapproved scene is never stamped.
    const unapproved = withDelivered(launch(), "shop", [{ key: "hero" }], at);
    expect(unapproved.destinations[0].slots[0].deliveredAt).toBeUndefined();
    // Exported an older output: not stamped.
    const stale = withDelivered(
      approved,
      "shop",
      [{ key: "hero", approvedOutput: "https://x/0.png" }],
      at,
    );
    expect(stale.destinations[0].slots[0].deliveredAt).toBeUndefined();
  });

  it("a new approval is not delivered yet", () => {
    const stamped = withDelivered(
      approveSlot(launch(), hero, card),
      "shop",
      [{ key: "hero", approvedOutput: "https://x/1.png" }],
      "2026-10-06T10:00:00.000Z",
    );
    const next = { status: "done" as const, outputs: ["https://x/2.png"] };
    const reapproved = approveSlot(stamped, hero, next);
    expect(reapproved.destinations[0].slots[0].deliveredAt).toBeUndefined();
    expect(
      unapproveSlot(stamped, hero).destinations[0].slots[0],
    ).not.toHaveProperty("deliveredAt");
  });
});

describe("photo order", () => {
  const launch = () =>
    planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog,
    });
  const keys = (p: ReturnType<typeof launch>) =>
    p.destinations[0].slots.map((s) => s.key);
  const ref = (slotKey: string) => ({ destinationId: "shop", slotKey });

  it("makes a slot photo 1, and moves one place at a time", () => {
    expect(keys(launch())).toEqual(["hero", "colours", "personalize"]);
    expect(keys(moveSlot(launch(), ref("personalize"), "first"))).toEqual([
      "personalize",
      "hero",
      "colours",
    ]);
    expect(keys(moveSlot(launch(), ref("hero"), "later"))).toEqual([
      "colours",
      "hero",
      "personalize",
    ]);
    expect(keys(moveSlot(launch(), ref("colours"), "earlier"))).toEqual([
      "colours",
      "hero",
      "personalize",
    ]);
    // Nowhere to go: unchanged; the other destination is untouched.
    expect(keys(moveSlot(launch(), ref("hero"), "earlier"))).toEqual(
      keys(launch()),
    );
    const moved = moveSlot(launch(), ref("hero"), "later");
    expect(moved.destinations[1]).toEqual(launch().destinations[1]);
  });

  it("a move renumbers the photos, so the last export's stamps are cleared", () => {
    const stamped = withDelivered(
      launch(),
      "shop",
      [{ key: "colours" }, { key: "personalize" }],
      "2026-10-06T10:00:00.000Z",
    );
    const moved = moveSlot(stamped, ref("personalize"), "first");
    expect(
      moved.destinations[0].slots.every((s) => s.deliveredAt === undefined),
    ).toBe(true);
    // No real move, nothing cleared.
    const still = moveSlot(stamped, ref("hero"), "first");
    expect(still.destinations[0].slots[1].deliveredAt).toBeDefined();
  });

  it("a move steps over switched-off slots", () => {
    const off = withSlotOff(launch(), ref("colours"), true);
    expect(keys(moveSlot(off, ref("hero"), "later"))).toEqual([
      "personalize",
      "colours",
      "hero",
    ]);
  });

  it("an unknown slot is refused", () => {
    expect(() => moveSlot(launch(), ref("nope"), "first")).toThrow(
      'no slot "nope"',
    );
  });
});

describe("versions and shared frames", () => {
  const seeds = {
    destinations: SEED_DESTINATIONS,
    shotLists: SEED_SHOT_LISTS,
  };
  const plan = (type: "content" | "launch", ids: string[]) =>
    planProject({
      product: CUTTING_BOARD,
      type,
      destinationIds: ids,
      catalog: seeds,
    });
  const slotOf = (p: ReturnType<typeof plan>, id: string, key: string) =>
    p.destinations
      .find((d) => d.destinationId === id)
      ?.slots.find((s) => s.key === key);
  const take = { status: "done" as const, outputs: ["https://x/in-use.png"] };

  it("a content plan re-frames its own slides for the story and the post", () => {
    const content = plan("content", ["instagram"]);
    expect(slotOf(content, "instagram", "story")).toMatchObject({
      fill: "scene",
      aspect: "9:16",
      versionOf: "instagram.hook",
      standalone: true,
    });
    expect(slotOf(content, "instagram", "post")).toMatchObject({
      fill: "scene",
      versionOf: "instagram.in-place",
    });
    // The versions are generated (they cost), but direct nothing of their own.
    expect(generableCardIds(content)).toContain("instagram.story");
  });

  it("a Launch makes each scene once: the same shot is shared, another size re-frames it", () => {
    const launch = plan("launch", ["etsy", "instagram"]);
    // Etsy's in-use and detail are 4:5 like the slides: shared, free.
    for (const [key, source] of [
      ["in-place", "etsy.in-use"],
      ["detail", "etsy.detail"],
    ]) {
      const slot = slotOf(launch, "instagram", key);
      expect(slot).toMatchObject({ fill: "shared", versionOf: source });
      expect(slot?.knobs).toBeUndefined();
      expect(slot?.scene).toBeUndefined();
    }
    // The square post re-frames Etsy's in-use, not the shared slide.
    expect(slotOf(launch, "instagram", "post")).toMatchObject({
      fill: "scene",
      versionOf: "etsy.in-use",
    });
    // The hook has no twin on Etsy: its own scene.
    expect(slotOf(launch, "instagram", "hook")?.versionOf).toBeUndefined();
    expect(generableCardIds(launch)).not.toContain("instagram.in-place");
    expect(planCounts(launch).shared).toBe(2);
  });

  it("a shared frame carries its scene's approval, and is never approved alone", () => {
    const launch = plan("launch", ["etsy", "instagram"]);
    const inUse = { destinationId: "etsy", slotKey: "in-use" };
    const approved = approveSlot(launch, inUse, take);
    const shared = slotOf(approved, "instagram", "in-place");
    expect(shared?.approvedOutput).toBe("https://x/in-use.png");
    expect(shared && slotState(shared).state).toBe("approved");
    expect(versionSource(approved, shared ?? {})?.slot.key).toBe("in-use");
    expect(() =>
      approveSlot(
        approved,
        { destinationId: "instagram", slotKey: "in-place" },
        take,
      ),
    ).toThrow("follows the scene it repeats");
    const withdrawn = unapproveSlot(approved, inUse);
    const after = slotOf(withdrawn, "instagram", "in-place");
    expect(after?.approvedOutput).toBeUndefined();
    expect(after && slotState(after).state).toBe("queued");
  });
});

describe("video slots", () => {
  // The same shot list, now with a video slot (as the Etsy seed gained one).
  const videoKit = ShotList.parse({
    ...shopKit,
    slots: [
      ...shopKit.slots,
      {
        key: "video",
        label: "Video",
        purpose: "In motion.",
        aspect: "9:16",
        fill: "video",
      },
    ],
  });
  const videoCatalog = {
    destinations: [shop, social],
    shotLists: [videoKit, socialEditorOnly, socialCarousel],
  };
  const withVideo = () =>
    planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog: videoCatalog,
    });
  // A plan made before video existed (the old shot list).
  const launch = () =>
    planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog,
    });
  const hero = { destinationId: "shop", slotKey: "hero" };
  const video = { destinationId: "shop", slotKey: "video" };
  const card = { status: "done" as const, outputs: ["https://x/hero.png"] };
  const shopOf = (p: ReturnType<typeof withVideo>) => p.destinations[0];
  const slotOf = (p: ReturnType<typeof withVideo>, key: string) =>
    shopOf(p).slots.find((s) => s.key === key)!;

  it("the queue may run scenes and videos switched on, never exact frames", () => {
    expect(generableCardIds(withVideo())).toEqual([
      "shop.hero",
      "shop.video",
      "social.hook",
    ]);
    expect(
      generableCardIds(withSlotOff(withVideo(), video, true)),
    ).not.toContain("shop.video");
    expect(planCounts(withVideo())).toMatchObject({ scene: 2, video: 1 });
  });

  it("prices the plan's videos beside its scenes, at each video's length", () => {
    const omni = {
      provider: "google",
      model: "gemini-omni-1.1-flash",
    };
    const shopWithVideo = { ...shop, video: { minSec: 5, maxSec: 15 } };
    // 8 s at $0.1014/s on Gemini Omni Flash 720p, plus $0.01 a clip.
    expect(planVideos(withVideo(), [shopWithVideo, social], omni)).toEqual({
      count: 1,
      seconds: [8],
      usd: 0.82,
    });
    expect(
      planVideos(withVideo(), [shopWithVideo, social], omni, ["shop.video"]),
    ).toEqual({ count: 0, seconds: [], usd: 0 });
    expect(
      planVideos(withSlotOff(withVideo(), video, true), [shopWithVideo], omni)
        .count,
    ).toBe(0);
    expect(
      planVideos(withVideo(), [shopWithVideo], {
        provider: "google",
        model: "veo-unpriced",
      }).usd,
    ).toBeNull();
  });

  it("starts from the first approved scene, a still camera with a light change, 8 s, vertical", () => {
    const plan = withVideo();
    const none = videoSettings(shopOf(plan), slotOf(plan, "video"), {
      minSec: 5,
      maxSec: 15,
    });
    expect(none).toMatchObject({ from: null, startFrame: null });
    const approved = approveSlot(plan, hero, card);
    expect(
      videoSettings(shopOf(approved), slotOf(approved, "video"), {
        minSec: 5,
        maxSec: 15,
      }),
    ).toEqual({
      from: "hero",
      startFrame: "https://x/hero.png",
      motion: "light",
      seconds: 8,
      orientation: "portrait",
      allowed: [5, 6, 7, 8, 9, 10],
    });
  });

  it("offers the lengths the card's model renders at its resolution", () => {
    const plan = withVideoChoice(approveSlot(withVideo(), hero, card), video, {
      seconds: 12,
    });
    const rules = { minSec: 5, maxSec: 15 };
    // A 12 s saved for Sora reads as 8 on Veo; 1080p renders only 8 s.
    expect(
      videoSettings(shopOf(plan), slotOf(plan, "video"), rules, {
        provider: "google",
        model: "veo-3.1-lite-generate-preview",
      }),
    ).toMatchObject({ seconds: 8, allowed: [6, 8] });
    expect(
      videoSettings(shopOf(plan), slotOf(plan, "video"), rules, {
        provider: "google",
        model: "veo-3.1-fast-generate-preview",
        resolution: "1080p",
      }),
    ).toMatchObject({ seconds: 8, allowed: [8] });
    // No length fits a 10-20 s destination: the nearest one the model renders.
    expect(
      videoSettings(
        shopOf(plan),
        slotOf(plan, "video"),
        { minSec: 10, maxSec: 20 },
        { provider: "google", model: "veo-3.1-fast-generate-preview" },
      ),
    ).toMatchObject({ seconds: 8, allowed: [8] });
  });

  it("keeps the maker's choices, within what the destination accepts", () => {
    const plan = withVideoChoice(approveSlot(withVideo(), hero, card), video, {
      motion: "light",
      seconds: 4,
      orientation: "landscape",
    });
    const s = videoSettings(shopOf(plan), slotOf(plan, "video"), {
      minSec: 5,
      maxSec: 15,
    });
    // 4 s is too short for a 5-15 s destination: back to 8.
    expect(s).toMatchObject({
      motion: "light",
      seconds: 8,
      orientation: "landscape",
    });
    expect(() => withVideoChoice(plan, hero, { motion: "pan" })).toThrow(
      "not a video slot",
    );
  });

  it("is approved like a scene and must be for delivery; it is not a photo", () => {
    let plan = approveSlot(withVideo(), hero, card);
    const clip = { status: "done" as const, outputs: ["https://x/v.mp4"] };
    expect(
      deliveryBlockers(shopOf(plan), (key) => (key === "video" ? clip : card))
        .notReady,
    ).toEqual(["Video"]);
    plan = approveSlot(plan, video, clip);
    expect(
      deliveryBlockers(shopOf(plan), (key) => (key === "video" ? clip : card))
        .notReady,
    ).toEqual([]);
    // A video never moves, and photo moves step over it.
    expect(moveSlot(plan, video, "first")).toEqual(plan);
    const last = moveSlot(
      plan,
      { destinationId: "shop", slotKey: "personalize" },
      "later",
    );
    expect(shopOf(last).slots.map((s) => s.key)).toEqual(
      shopOf(plan).slots.map((s) => s.key),
    );
  });

  it("a plan made before video gets its slot added once", () => {
    const old = launch();
    const added = addVideoSlot(old, "shop", videoCatalog.shotLists);
    expect(added?.slot).toMatchObject({ key: "video", fill: "video" });
    expect(shopOf(added!.plan).slots.at(-1)?.key).toBe("video");
    expect(
      addVideoSlot(added!.plan, "shop", videoCatalog.shotLists),
    ).toBeNull();
    // A destination whose shot list has no video.
    expect(addVideoSlot(old, "social", videoCatalog.shotLists)).toBeNull();
  });
});

describe("withListing", () => {
  it("saves a destination's listing text in the plan, the slots untouched", () => {
    const plan = planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog,
    });
    const listing = listingDraft(CUTTING_BOARD);
    const next = withListing(plan, "shop", listing);
    expect(next.destinations[0].listing).toEqual(listing);
    expect(next.destinations[0].slots).toEqual(plan.destinations[0].slots);
    expect(next.destinations[1].listing).toBeUndefined();
    // Stored as JSON, it reads back; a plan without one still reads.
    expect(ProjectPlan.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(() => withListing(plan, "nowhere", listing)).toThrow(
      /not a destination/,
    );
  });
});

describe("withBrief", () => {
  const brief = MarketBrief.parse({
    searches: [
      {
        term: "cutting board",
        searches: 27900,
        source: "typed",
        readOn: "2026-10-26",
      },
    ],
  });

  it("keeps a destination's market brief, reads back from JSON, and survives a replan", () => {
    const plan = planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop", "social"],
      catalog,
    });
    const next = withBrief(plan, "shop", brief);
    expect(next.destinations[0].brief).toEqual(brief);
    expect(next.destinations[1]).not.toHaveProperty("brief");
    expect(ProjectPlan.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(
      replan(next, CUTTING_BOARD, catalog.shotLists).plan.destinations[0].brief,
    ).toEqual(brief);
    expect(
      withBrief(next, "shop", undefined).destinations[0],
    ).not.toHaveProperty("brief");
    expect(() => withBrief(plan, "nowhere", brief)).toThrow(
      /not a destination/,
    );
  });
});

describe("the plan's references", () => {
  const view = {
    assetUrl: "https://stub.local/plates/above.png",
    angleDeg: 30,
    front: "https://stub.local/plates/front.png",
  };

  it("are kept by every change to the plan", () => {
    const plan = withThreeQuarter(
      planProject({
        product: CUTTING_BOARD,
        type: "launch",
        destinationIds: ["shop", "social"],
        catalog,
      }),
      view,
    );
    const hero = { destinationId: "shop", slotKey: "hero" };
    const changed = [
      moveSlot(
        plan,
        { destinationId: "shop", slotKey: plan.destinations[0].slots[1].key },
        "first",
      ),
      withDelivered(plan, "shop", [], "2026-10-27T00:00:00.000Z"),
      withListing(plan, "shop", listingDraft(CUTTING_BOARD)),
      withBrief(plan, "shop", undefined),
      withSlotOff(plan, hero, true),
      replan(plan, CUTTING_BOARD, catalog.shotLists).plan,
    ];
    for (const next of changed) {
      expect(next.references).toEqual({ threeQuarter: view });
      expect(
        ProjectPlan.parse(JSON.parse(JSON.stringify(next))).references,
      ).toEqual({
        threeQuarter: view,
      });
    }
    expect(withThreeQuarter(plan, null)).not.toHaveProperty("references");
  });

  it("an unreadable reference reads as none, and the plan still parses", () => {
    const plan = planProject({
      product: CUTTING_BOARD,
      type: "launch",
      destinationIds: ["shop"],
      catalog,
    });
    expect(
      ProjectPlan.parse({
        ...plan,
        references: { threeQuarter: { assetUrl: 3 } },
      }).references,
    ).toBeUndefined();
  });
});

describe("a destination's results", () => {
  const plan = planProject({
    product: CUTTING_BOARD,
    type: "launch",
    destinationIds: ["shop", "social"],
    catalog,
  });
  const before = {
    from: "2026-09-27",
    to: "2026-10-26",
    visits: 40,
    orders: 2,
    source: "Etsy Stats",
    readOn: "2026-10-27",
  };

  it("keeps the listing's address, its reads and the day it went live, through a replan", () => {
    let next = withListingUrl(
      plan,
      "shop",
      "https://www.etsy.com/listing/4413933723/board",
    );
    next = withRead(next, "shop", "before", before);
    next = withLiveOn(next, "shop", "2026-10-27");
    expect(next.destinations[0]).toMatchObject({
      listingUrl: "https://www.etsy.com/listing/4413933723/board",
      results: { liveOn: "2026-10-27", reads: { before } },
    });
    expect(next.destinations[1]).not.toHaveProperty("results");
    expect(ProjectPlan.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(
      replan(next, CUTTING_BOARD, catalog.shotLists).plan.destinations[0]
        .results,
    ).toEqual(next.destinations[0].results);
  });

  it("takes a read back, the day back to the delivery, and stops following", () => {
    let next = withRead(plan, "shop", "before", before);
    next = withLiveOn(next, "shop", "2026-10-27");
    next = withRead(next, "shop", "before", null);
    next = withLiveOn(next, "shop", null);
    expect(next.destinations[0].results).toEqual({ reads: {} });
    expect(
      withFollowing(next, "shop", false).destinations[0].results?.stopped,
    ).toBe(true);
    expect(
      withFollowing(withFollowing(next, "shop", false), "shop", true)
        .destinations[0].results,
    ).toEqual({ reads: {} });
    expect(
      withListingUrl(
        withListingUrl(plan, "shop", "https://example.com/l/1"),
        "shop",
        null,
      ).destinations[0],
    ).not.toHaveProperty("listingUrl");
  });

  it("refuses a read that does not parse, a plain-http address and an unknown destination", () => {
    expect(() =>
      withRead(plan, "shop", "day14", { ...before, visits: -1 }),
    ).toThrow();
    expect(() =>
      withListingUrl(plan, "shop", "http://www.etsy.com/listing/1"),
    ).toThrow(/https/);
    expect(() => withRead(plan, "nowhere", "before", before)).toThrow(
      /not a destination/,
    );
  });
});

describe("withSlotPlace", () => {
  const plan = planProject({
    product: CUTTING_BOARD,
    type: "listing-kit",
    destinationIds: ["etsy"],
    catalog: { destinations: SEED_DESTINATIONS, shotLists: SEED_SHOT_LISTS },
  });
  const slot = (p: ProjectPlan, key: string) =>
    p.destinations[0].slots.find((s) => s.key === key);

  it("gives a scene its own place; a hero with a setting stands there, in its place", () => {
    const inUse = withSlotPlace(
      plan,
      { destinationId: "etsy", slotKey: "in-use" },
      "  a farmhouse table set for brunch ",
    );
    expect(slot(inUse, "in-use")?.place).toBe(
      "a farmhouse table set for brunch",
    );
    expect(slot(inUse, "in-use")?.tuned).toBeUndefined();
    const hero = withSlotPlace(
      plan,
      { destinationId: "etsy", slotKey: "hero" },
      "an open shelf in a bright kitchen",
    );
    expect(slot(hero, "hero")).toMatchObject({
      place: "an open shelf in a bright kitchen",
      tuned: { setting: "place" },
    });
  });

  it("null gives the scene back the product's places; an exact frame has none", () => {
    const ref = { destinationId: "etsy", slotKey: "in-use" };
    const back = withSlotPlace(withSlotPlace(plan, ref, "a table"), ref, null);
    expect(slot(back, "in-use")).not.toHaveProperty("place");
    expect(() =>
      withSlotPlace(plan, { destinationId: "etsy", slotKey: "size" }, "a desk"),
    ).toThrow("not a scene slot");
    expect(() => withSlotPlace(plan, ref, "x".repeat(161))).toThrow(
      /at most 160/,
    );
  });
});

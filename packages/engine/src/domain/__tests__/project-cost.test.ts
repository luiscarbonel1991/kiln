import { describe, expect, it } from "vitest";
import { approveSlot, planProject, withSlotOff } from "@/domain/plan";
import { projectCost } from "@/domain/project-cost";
import { SEED_DESTINATIONS, SEED_SHOT_LISTS } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const launch = () =>
  planProject({
    product: CUTTING_BOARD,
    type: "launch",
    destinationIds: ["etsy", "instagram"],
    catalog: { destinations: SEED_DESTINATIONS, shotLists: SEED_SHOT_LISTS },
  });
const take = (url: string) => ({ status: "done" as const, outputs: [url] });

describe("projectCost", () => {
  it("costs each frame every take it took, and the project per approved frame", () => {
    let plan = approveSlot(
      launch(),
      { destinationId: "etsy", slotKey: "hero" },
      take("https://x/hero-2.png"),
    );
    plan = approveSlot(
      plan,
      { destinationId: "etsy", slotKey: "in-use" },
      take("https://x/in-use.png"),
    );
    const spend = new Map([
      // The hero took a re-roll: both takes count.
      ["etsy.hero", { spentMicros: 120_000, takes: 2 }],
      ["etsy.in-use", { spentMicros: 60_000, takes: 1 }],
      ["etsy.video", { spentMicros: 800_000, takes: 1 }],
    ]);
    const cost = projectCost(plan, spend, 40_000);
    const etsy = cost.destinations[0];
    expect(etsy.frames.find((f) => f.slotKey === "hero")).toMatchObject({
      spentMicros: 120_000,
      takes: 2,
      approved: true,
    });
    // The video is not approved yet: it spent, but approves nothing.
    expect(etsy).toMatchObject({
      spentMicros: 980_000,
      takes: 4,
      approved: 2,
      perApprovedMicros: 490_000,
    });
    // Instagram's "in place" is Etsy's scene shared: it spent nothing, and
    // it is no frame of its own to approve.
    const instagram = cost.destinations[1];
    expect(instagram.frames.map((f) => f.slotKey)).not.toContain("in-place");
    expect(instagram.spentMicros).toBe(0);
    expect(cost).toMatchObject({
      spentMicros: 1_020_000,
      otherMicros: 40_000,
      approved: 2,
      perApprovedMicros: 510_000,
    });
  });

  it("a frame switched off or dropped still counts its spend, apart from the frames", () => {
    const plan = withSlotOff(
      launch(),
      { destinationId: "etsy", slotKey: "gift" },
      true,
    );
    const cost = projectCost(
      plan,
      new Map([
        ["etsy.gift", { spentMicros: 55_000, takes: 1 }],
        ["etsy.old", { spentMicros: 5_000, takes: 1 }],
      ]),
    );
    expect(cost.destinations[0].spentMicros).toBe(0);
    expect(cost).toMatchObject({
      otherMicros: 60_000,
      spentMicros: 60_000,
      takes: 2,
      perApprovedMicros: null,
    });
  });
});

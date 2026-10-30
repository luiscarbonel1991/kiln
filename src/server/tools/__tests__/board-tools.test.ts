import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectPlan } from "@/domain/plan";

// approve_frame, unapprove_frame and reject_frame on stubbed repositories
// (their DB suites cover the writes): what each checks first, and what a
// reason moves.

const state = vi.hoisted(() => ({
  approvals: [] as unknown[][],
  tuned: [] as unknown[],
  approvedOutput: null as string | null,
}));

const frame = (over: Record<string, unknown> = {}) => ({
  frame: "etsy.hero",
  destinationId: "etsy",
  slotKey: "hero",
  label: "Hero",
  fill: "scene",
  state: "to-review",
  failed: false,
  output: "https://x/hero-2.png",
  approvedOutput: state.approvedOutput,
  approvable: true,
  ...over,
});

vi.mock("@/server/project-frames", () => ({
  framedProjects: async () => [],
  projectFrames: async (id: string) =>
    id === "p1"
      ? {
          project: { id, name: "Planter", type: "listing-kit", phase: "x" },
          frames: [
            frame(),
            frame({
              frame: "etsy.size",
              slotKey: "size",
              fill: "exact",
              output: null,
            }),
          ],
        }
      : null,
}));

const plan = {
  destinations: [
    {
      destinationId: "etsy",
      slots: [
        {
          key: "hero",
          label: "Hero",
          fill: "scene",
          knobs: { props: "styled", light: "window" },
        },
      ],
    },
  ],
} as unknown as ProjectPlan;

vi.mock("@/server/project-repository", async () => {
  const { SlotRefusal } = await import("@/domain/plan");
  return {
    loadProjectBoard: async () => ({
      board: { plan, master: { assetUrl: "https://x/master.png" } },
    }),
    setSlotApproval: async (
      project: string,
      ref: unknown,
      approved: boolean,
      checked?: string,
    ) => {
      if (checked === "https://x/hero-1.png") {
        throw new SlotRefusal(
          "stale",
          "A newer take landed since: https://x/hero-2.png.",
        );
      }
      state.approvals.push([project, ref, approved, checked]);
    },
  };
});
vi.mock("@/server/slot-tuning", () => ({
  retuneSlot: async (
    _project: string,
    _ref: unknown,
    tune: (p: ProjectPlan) => ProjectPlan,
  ) => {
    const next = tune(plan);
    state.tuned.push(next.destinations[0].slots[0].tuned);
    return { product: null, plan: next };
  },
}));
vi.mock("@/providers/asset-bytes", () => ({ fetchAsset: vi.fn() }));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const CTX = { tokenId: "t1", tokenName: "agent", canSpend: false };
const call = (name: string, args: Record<string, unknown>) =>
  callTool(TOOLS, name, args, CTX);

afterEach(() => {
  state.approvals.length = 0;
  state.tuned.length = 0;
  state.approvedOutput = null;
});

describe("approve_frame", () => {
  it("approves the take named, and needs one", async () => {
    const take = "https://x/hero-2.png";
    expect(
      await call("approve_frame", { project: "p1", frame: "etsy.hero", take }),
    ).toMatchObject({ ok: true });
    expect(state.approvals).toEqual([
      ["p1", { destinationId: "etsy", slotKey: "hero" }, true, take],
    ]);
    expect(
      await call("approve_frame", { project: "p1", frame: "etsy.hero" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("take"),
    });
  });

  it("refuses a stale take and an unknown frame in words", async () => {
    expect(
      await call("approve_frame", {
        project: "p1",
        frame: "etsy.hero",
        take: "https://x/hero-1.png",
      }),
    ).toEqual({
      ok: false,
      error: "A newer take landed since: https://x/hero-2.png.",
    });
    expect(
      await call("approve_frame", {
        project: "p1",
        frame: "etsy.nope",
        take: "https://x/a.png",
      }),
    ).toEqual({
      ok: false,
      error: 'This project has no frame "etsy.nope": get_frames lists them.',
    });
    expect(state.approvals).toEqual([]);
  });
});

describe("reject_frame", () => {
  const take = "https://x/hero-2.png";

  it("moves the reason's knob, as the board's chip does", async () => {
    const answer = await call("reject_frame", {
      project: "p1",
      frame: "etsy.hero",
      take,
      reason: "busy",
    });
    expect(answer).toMatchObject({
      ok: true,
      output: {
        data: { moved: { knob: "Props", to: "A few" }, unapproved: false },
      },
    });
    expect(state.tuned).toEqual([{ props: "few" }]);
    expect(state.approvals).toEqual([]);
  });

  it("withdraws the approval of the take it rejects", async () => {
    state.approvedOutput = take;
    await call("reject_frame", {
      project: "p1",
      frame: "etsy.hero",
      take,
      reason: "dark",
    });
    expect(state.approvals).toEqual([
      ["p1", { destinationId: "etsy", slotKey: "hero" }, false, undefined],
    ]);
    expect(state.tuned).toEqual([{ light: "studio" }]);
  });

  it("refuses a reason the scene cannot take, a newer take, and an exact frame", async () => {
    expect(
      await call("reject_frame", {
        project: "p1",
        frame: "etsy.hero",
        take,
        reason: "top",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("no camera knob"),
    });
    expect(
      await call("reject_frame", {
        project: "p1",
        frame: "etsy.hero",
        take: "https://x/old.png",
        reason: "busy",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("A newer take landed since"),
    });
    expect(
      await call("reject_frame", {
        project: "p1",
        frame: "etsy.size",
        take,
        reason: "busy",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("is not a scene"),
    });
    expect(state.tuned).toEqual([]);
  });
});

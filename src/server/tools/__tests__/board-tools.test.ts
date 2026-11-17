import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectPlan } from "@/domain/plan";

// approve_frame, unapprove_frame and reject_frame on stubbed repositories
// (their DB suites cover the writes): what each checks first, what a reason
// moves, and that each tells the maker's lessons (lessons.db.test.ts).

const state = vi.hoisted(() => ({
  approvals: [] as unknown[][],
  tuned: [] as unknown[],
  places: [] as unknown[],
  looks: [] as unknown[],
  switched: [] as unknown[][],
  noted: [] as unknown[][],
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
  projectFrames: async (_maker: unknown, id: string) =>
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
      _maker: unknown,
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
    setSlotOff: async (
      _maker: unknown,
      project: string,
      ref: unknown,
      off: boolean,
    ) => {
      state.switched.push([project, ref, off]);
    },
  };
});
vi.mock("@/server/slot-tuning", () => ({
  relookSlot: async (
    _maker: unknown,
    _project: string,
    _ref: unknown,
    asked: { colour?: string | null },
  ) => {
    state.looks.push(asked);
    // A door tag whose name says its default colour: the answer passes on
    // that it contradicts gold.
    const { DOOR_TAG } = await import("@/domain/__tests__/fixtures/door-tag");
    const product = { ...DOOR_TAG, name: "Engraved door tag, black & white" };
    const [d] = plan.destinations;
    const slots = d.slots.map((s, i) =>
      i === 0 && asked.colour ? { ...s, look: { colour: asked.colour } } : s,
    );
    return { product, plan: { ...plan, destinations: [{ ...d, slots }] } };
  },
  retuneSlot: async (
    _maker: unknown,
    _project: string,
    _ref: unknown,
    tune: (p: ProjectPlan) => ProjectPlan,
  ) => {
    const next = tune(plan);
    state.tuned.push(next.destinations[0].slots[0].tuned);
    state.places.push(next.destinations[0].slots[0].place);
    return { product: null, plan: next };
  },
}));
vi.mock("@/providers/asset-bytes", () => ({ fetchAsset: vi.fn() }));
vi.mock("@/server/lessons", () => ({
  noteApproval: async (_maker: unknown, ...args: unknown[]) => {
    state.noted.push(["approval", ...args]);
  },
  noteReason: async (_maker: unknown, ...args: unknown[]) => {
    state.noted.push(["reason", ...args]);
  },
}));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const CTX = {
  maker: { id: "test" },
  tokenId: "t1",
  tokenName: "agent",
  canSpend: false,
};
const call = (name: string, args: Record<string, unknown>) =>
  callTool(TOOLS, name, args, CTX);

afterEach(() => {
  state.approvals.length = 0;
  state.looks.length = 0;
  state.tuned.length = 0;
  state.places.length = 0;
  state.switched.length = 0;
  state.noted.length = 0;
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
    expect(state.noted).toEqual([
      ["approval", "p1", { destinationId: "etsy", slotKey: "hero" }],
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
    expect(state.noted).toEqual([
      [
        "reason",
        "p1",
        { destinationId: "etsy", slotKey: "hero" },
        "busy",
        { knob: "props", stop: "few" },
      ],
    ]);
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

describe("tune_frame", () => {
  it("sets several knobs and a place at once, and answers the scene's knobs", async () => {
    const answer = await call("tune_frame", {
      project: "p1",
      frame: "etsy.hero",
      knobs: { props: "none", light: "default" },
      place: "on a walnut desk",
    });
    expect(state.tuned).toEqual([{ props: "none" }]);
    expect(state.places).toEqual(["on a walnut desk"]);
    expect(answer).toMatchObject({
      ok: true,
      output: {
        data: {
          frame: "etsy.hero",
          knobs: {
            props: { stop: "none", by: "maker" },
            light: { stop: "window", by: "default" },
          },
          place: "on a walnut desk",
        },
      },
    });
  });

  it("shows a scene in a colour and style of its own, or the project's again with null", async () => {
    const answer = await call("tune_frame", {
      project: "p1",
      frame: "etsy.hero",
      colour: "gold-black",
      style: null,
    });
    expect(state.looks).toEqual([{ colour: "gold-black", style: null }]);
    expect(state.tuned).toEqual([]);
    expect(answer).toMatchObject({
      ok: true,
      output: {
        data: {
          frame: "etsy.hero",
          look: {
            colour: "gold-black",
            name: "Gold/Black · Quiet please",
            textWarning: expect.stringContaining("its name says white"),
          },
        },
      },
    });
  });

  it("refuses a knob the scene does not offer, nothing to set, and a frame that is not a scene", async () => {
    expect(
      await call("tune_frame", {
        project: "p1",
        frame: "etsy.hero",
        knobs: { camera: "above" },
      }),
    ).toEqual({ ok: false, error: "this scene has no camera knob" });
    expect(
      await call("tune_frame", { project: "p1", frame: "etsy.hero" }),
    ).toEqual({ ok: false, error: "Name a knob to set, a place, or a look." });
    expect(
      await call("tune_frame", {
        project: "p1",
        frame: "etsy.size",
        knobs: { props: "none" },
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a scene"),
    });
    expect(
      await call("tune_frame", {
        project: "p1",
        frame: "etsy.hero",
        knobs: { props: "glitter" },
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("switch_frame", () => {
  it("switches a frame off and on", async () => {
    await call("switch_frame", {
      project: "p1",
      frame: "etsy.hero",
      on: false,
    });
    await call("switch_frame", { project: "p1", frame: "etsy.hero", on: true });
    const ref = { destinationId: "etsy", slotKey: "hero" };
    expect(state.switched).toEqual([
      ["p1", ref, true],
      ["p1", ref, false],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { frameSlots, frameViews, waitingFrames } from "@/domain/frame-view";
import { approveSlot, planProject, withSlotLook } from "@/domain/plan";
import { SEED_DESTINATIONS, SEED_SHOT_LISTS } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";
import { DOOR_TAG } from "./fixtures/door-tag";

const launch = () =>
  planProject({
    product: CUTTING_BOARD,
    type: "launch",
    destinationIds: ["etsy", "instagram"],
    catalog: { destinations: SEED_DESTINATIONS, shotLists: SEED_SHOT_LISTS },
  });
const take = (url: string) => ({ status: "done" as const, outputs: [url] });

describe("frameViews", () => {
  it("names each scene's look for a product in more than one, and none for one in a single look", () => {
    const plan = withSlotLook(
      planProject({
        product: DOOR_TAG,
        type: "listing-kit",
        destinationIds: ["etsy"],
        catalog: {
          destinations: SEED_DESTINATIONS,
          shotLists: SEED_SHOT_LISTS,
        },
      }),
      { destinationId: "etsy", slotKey: "hero" },
      { colour: "gold-black", style: "do-not-disturb" },
    );
    const frames = frameViews(plan, {}, {}, DOOR_TAG);
    const at = (frame: string) => frames.find((f) => f.frame === frame);
    expect(at("etsy.hero")?.look).toEqual({
      colour: "gold-black",
      style: "do-not-disturb",
      name: "Gold/Black · Do not disturb",
    });
    expect(at("etsy.in-use")?.look).toEqual({
      colour: "black-white",
      name: "Black/White · Quiet please",
    });
    expect(at("etsy.size")).not.toHaveProperty("look");
    expect(frameViews(plan, {}, {})[0]).not.toHaveProperty("look");
  });

  it("passes on what in the product's text contradicts a scene's colour", () => {
    const named = { ...DOOR_TAG, name: "Engraved door tag, black & white" };
    const plan = withSlotLook(
      planProject({
        product: named,
        type: "listing-kit",
        destinationIds: ["etsy"],
        catalog: {
          destinations: SEED_DESTINATIONS,
          shotLists: SEED_SHOT_LISTS,
        },
      }),
      { destinationId: "etsy", slotKey: "hero" },
      { colour: "gold-black" },
    );
    const frames = frameViews(plan, {}, {}, named);
    const at = (frame: string) => frames.find((f) => f.frame === frame);
    expect(at("etsy.hero")?.look?.textWarning).toContain("its name says white");
    expect(at("etsy.in-use")?.look).not.toHaveProperty("textWarning");
  });

  it("passes on Kiln's check of a scene's shown take, and null for one never checked", () => {
    const check = {
      status: "failed" as const,
      engine: "apple-vision",
      lines: [{ expected: "205", found: false }],
      problems: ['missing "205"'],
      notes: [],
      scale: "10 x 6 in, about 1/3 as wide as the door",
      checkedAt: "2026-11-02T10:00:00.000Z",
    };
    const frames = frameViews(
      launch(),
      {
        "etsy.hero": take("https://x/hero.png"),
        "etsy.in-use": take("https://x/in-use.png"),
      },
      {},
      CUTTING_BOARD,
      { "etsy.hero": check, "etsy.in-use": null, "etsy.size": check },
    );
    const at = (frame: string) => frames.find((f) => f.frame === frame);
    expect(at("etsy.hero")?.check).toEqual({
      status: "failed",
      problems: ['missing "205"'],
      notes: [],
      scale: "10 x 6 in, about 1/3 as wide as the door",
    });
    expect(at("etsy.in-use")?.check).toBeNull();
    // Only a scene with a take shown carries one.
    expect(at("etsy.size")).not.toHaveProperty("check");
    expect(at("etsy.detail")).not.toHaveProperty("check");
  });

  it("names each frame, its state and the take an approval would approve", () => {
    const plan = approveSlot(
      launch(),
      { destinationId: "etsy", slotKey: "in-use" },
      take("https://x/in-use.png"),
    );
    const frames = frameViews(
      plan,
      {
        "etsy.hero": take("https://x/hero-2.png"),
        "etsy.in-use": take("https://x/in-use.png"),
        // A re-roll on its way: its last take is not what approval reads.
        "etsy.detail": { status: "rendering", outputs: ["https://x/d.png"] },
      },
      { "etsy.lifestyle": { status: "queued", attempt: 0 } },
    );
    const at = (frame: string) => frames.find((f) => f.frame === frame);
    expect(at("etsy.hero")).toMatchObject({
      destinationId: "etsy",
      slotKey: "hero",
      fill: "scene",
      state: "to-review",
      output: "https://x/hero-2.png",
      approvedOutput: null,
      approvable: true,
    });
    expect(at("etsy.in-use")).toMatchObject({
      state: "approved",
      output: "https://x/in-use.png",
      approvedOutput: "https://x/in-use.png",
      approvable: false,
    });
    expect(at("etsy.detail")).toMatchObject({
      state: "generating",
      output: null,
      approvable: false,
    });
    expect(at("etsy.lifestyle")).toMatchObject({
      state: "queued",
      approvable: false,
    });
    // An exact frame is drawn at export: nothing to read or approve here.
    const exact = frames.find((f) => f.fill === "exact");
    expect(exact).toMatchObject({ state: "exact", output: null });
    // Instagram's "in place" repeats Etsy's approved scene.
    expect(at("instagram.in-place")).toMatchObject({
      fill: "shared",
      versionOf: "etsy.in-use",
      state: "approved",
      output: "https://x/in-use.png",
      approvable: false,
    });
  });

  it("lists every slot of every destination in the plan's order", () => {
    const plan = launch();
    const frames = frameViews(plan, {}, {});
    expect(frames.map((f) => f.frame)).toEqual(
      plan.destinations.flatMap((d) =>
        d.slots.map((s) => `${d.destinationId}.${s.key}`),
      ),
    );
  });

  it("names the model a take ran on after a move down its route", () => {
    const ranOn = {
      label: "Gemini 3.1 Flash Image",
      from: "GPT Image 2",
      reason: "OpenAI answered 503",
    };
    const frames = frameViews(
      launch(),
      { "etsy.hero": take("https://x/hero.png") },
      { "etsy.hero": { status: "done", attempt: 1, ranOn } },
    );
    expect(frames.find((f) => f.frame === "etsy.hero")?.ranOn).toEqual(ranOn);
    expect(frames.find((f) => f.frame === "etsy.size")).not.toHaveProperty(
      "ranOn",
    );
  });
});

describe("waitingFrames", () => {
  it("is the scenes with a card and no take, nothing queued for them", () => {
    const plan = launch();
    const scenes = plan.destinations.flatMap((d) =>
      d.slots
        .filter((s) => s.fill === "scene" && !s.versionOf)
        .map((s) => `${d.destinationId}.${s.key}`),
    );
    const draft = { status: "draft" as const, outputs: [] };
    const cards = Object.fromEntries(scenes.map((id) => [id, draft]));
    const [first, second, third] = scenes;
    const waiting = waitingFrames(
      frameSlots(
        plan,
        {
          ...cards,
          [first]: take("https://x/a.png"),
          [third]: { status: "error" as const, outputs: [] },
        },
        { [second]: { status: "queued", attempt: 0 } },
      ),
    );
    // A take waits for a decision, not a batch; a failed one counts.
    expect(waiting).not.toContain(first);
    expect(waiting).not.toContain(second);
    expect(waiting).toContain(third);
    expect(waiting.every((id) => scenes.includes(id))).toBe(true);
    // No card yet (not drafted): nothing to generate from.
    expect(waitingFrames(frameSlots(plan, {}, {}))).toEqual([]);
  });
});

describe("a test take", () => {
  it("shows to review, marked as a test, and is never approvable", () => {
    const frames = frameViews(
      launch(),
      { "etsy.hero": take("https://x/hero-test.png") },
      { "etsy.hero": { status: "done", attempt: 1, test: true } },
    );
    expect(frames.find((f) => f.frame === "etsy.hero")).toMatchObject({
      state: "to-review",
      test: true,
      approvable: false,
    });
  });
});

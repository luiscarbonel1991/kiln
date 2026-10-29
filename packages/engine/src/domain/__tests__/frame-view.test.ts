import { describe, expect, it } from "vitest";
import { frameViews } from "@/domain/frame-view";
import { approveSlot, planProject } from "@/domain/plan";
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

describe("frameViews", () => {
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

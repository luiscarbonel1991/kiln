import { describe, expect, it } from "vitest";
import {
  agreedStop,
  familyKey,
  LessonMove,
  sceneLessonKey,
  sceneLessonText,
  withLearned,
} from "@/domain/lesson";
import { planProject } from "@/domain/plan";
import { effectiveKnobs } from "@/domain/scene-knobs";
import { SEED_DESTINATIONS, SEED_SHOT_LISTS } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const catalog = { destinations: SEED_DESTINATIONS, shotLists: SEED_SHOT_LISTS };

describe("agreedStop", () => {
  it("needs two of the maker's choices to agree; one is a whim", () => {
    expect(agreedStop([{ kind: "reason", reason: "top", stop: "above" }])).toBe(
      null,
    );
    expect(
      agreedStop([
        { kind: "approval", stop: "above" },
        { kind: "reason", reason: "top", stop: "above" },
        { kind: "approval", stop: "eye" },
      ]),
    ).toEqual({ stop: "above", approvals: 1, reasons: { top: 1 } });
  });

  it("goes to the most voted stop, a tie to the latest (votes come newest first)", () => {
    const votes = [
      { kind: "approval" as const, stop: "eye" },
      { kind: "approval" as const, stop: "above" },
      { kind: "approval" as const, stop: "eye" },
      { kind: "approval" as const, stop: "above" },
    ];
    expect(agreedStop(votes)?.stop).toBe("eye");
    expect(
      agreedStop([{ kind: "approval", stop: "above" }, ...votes])?.stop,
    ).toBe("above");
  });
});

describe("a scene lesson", () => {
  it("says what the maker's choices agree on, in their words", () => {
    expect(
      sceneLessonText({
        family: " Kitchen ",
        destination: "Etsy",
        slot: "Hero",
        knob: "camera",
        agreed: { stop: "above", approvals: 2, reasons: { top: 1 } },
      }),
    ).toBe(
      `Kitchen, Etsy's Hero: the camera a little above (approved twice with it; "Can't see its top" once).`,
    );
  });

  it("is keyed by the family however it is written, the frame and the knob", () => {
    const move = {
      destinationId: "etsy",
      slotKey: "hero",
      knob: "camera" as const,
    };
    expect(sceneLessonKey("Kitchen", move)).toBe(
      sceneLessonKey(" kitchen ", move),
    );
    expect(familyKey(" Kitchen ")).toBe("kitchen");
  });

  it("moves a knob to one of its own stops, never to any", () => {
    const move = { destinationId: "etsy", slotKey: "hero", knob: "camera" };
    expect(LessonMove.safeParse({ ...move, stop: "above" }).success).toBe(true);
    expect(LessonMove.safeParse({ ...move, stop: "any" }).success).toBe(false);
    expect(LessonMove.safeParse({ ...move, stop: "studio" }).success).toBe(
      false,
    );
  });
});

describe("withLearned", () => {
  const plan = planProject({
    product: CUTTING_BOARD,
    type: "listing-kit",
    destinationIds: ["etsy"],
    catalog,
  });
  const hero = (p: typeof plan) =>
    p.destinations[0].slots.find((s) => s.key === "hero");

  it("starts the frame's knob from a kept lesson, only where the scene offers it", () => {
    const learned = withLearned(plan, [
      { destinationId: "etsy", slotKey: "hero", knob: "camera", stop: "above" },
      { destinationId: "etsy", slotKey: "nope", knob: "camera", stop: "above" },
      {
        destinationId: "website",
        slotKey: "hero",
        knob: "camera",
        stop: "above",
      },
    ]);
    expect(hero(learned)?.learned).toEqual({ camera: "above" });
    expect(learned.destinations[0].slots.filter((s) => s.learned)).toHaveLength(
      1,
    );
    expect(withLearned(plan, [])).toBe(plan);
  });

  it("is over Kiln's pick and under the maker's own choice", () => {
    const defaults = { camera: "eye" as const, distance: "medium" as const };
    const lesson = { camera: "above" as const };
    const knobs = effectiveKnobs(defaults, {}, { camera: "overhead" }, lesson);
    expect(knobs.stops.camera).toBe("above");
    expect(knobs.learned).toEqual(["camera"]);
    expect(knobs.picked).toEqual([]);
    const mine = effectiveKnobs(defaults, { camera: "eye" }, {}, lesson);
    expect(mine.stops.camera).toBe("eye");
    expect(mine.learned).toEqual([]);
    expect(mine.chosen).toEqual(["camera"]);
  });
});

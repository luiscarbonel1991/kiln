import { describe, expect, it } from "vitest";
import {
  effectiveKnobs,
  KNOBS,
  KnobKey,
  knobStops,
  knobSummary,
  knobText,
  REASONS,
  ReasonKey,
  reasonMove,
  SavedKnobs,
  SceneKnobs,
} from "@/domain/scene-knobs";
import { CUTTING_BOARD } from "./fixtures/cutting-board";
import { PLATE_ON_BASE } from "./fixtures/plate-on-base";

const IN_USE = {
  camera: "eye",
  distance: "medium",
  light: "window",
  props: "few",
} as const;

describe("the knobs", () => {
  it("each starts with an 'any' stop that adds nothing", () => {
    for (const k of KnobKey.options) {
      expect(knobStops(k)[0]).toBe("any");
      expect(KNOBS[k].stops.any.text).toBe("");
    }
  });

  it("every other stop has a label, a hint and a clause", () => {
    for (const k of KnobKey.options) {
      for (const stop of knobStops(k).slice(1)) {
        const s = (
          KNOBS[k].stops as Record<
            string,
            { label: string; hint: string; text: string }
          >
        )[stop];
        expect(s.label && s.hint && s.text).toBeTruthy();
      }
    }
  });

  it("the seed's stops are strict; a saved plan's are tolerant", () => {
    expect(SceneKnobs.safeParse({ camera: "eyes" }).success).toBe(false);
    expect(SceneKnobs.safeParse({ lens: "wide" }).success).toBe(false);
    expect(SavedKnobs.parse({ camera: "eyes", light: "studio" })).toEqual({
      light: "studio",
    });
  });
});

describe("effectiveKnobs", () => {
  it("offers the slot's knobs with its defaults", () => {
    const e = effectiveKnobs(IN_USE, CUTTING_BOARD);
    expect(e.offered).toEqual(["camera", "distance", "light", "props"]);
    expect(e.stops).toEqual(IN_USE);
    expect(e.chosen).toEqual([]);
    expect(e.why).toEqual({});
  });

  it("raises the camera for a product with a part lying flat, and says why", () => {
    const e = effectiveKnobs(IN_USE, PLATE_ON_BASE);
    expect(e.stops.camera).toBe("above");
    expect(e.why.camera).toBe(
      "Its base lies flat; from a little above, its top shows",
    );
    expect(effectiveKnobs({ camera: "any" }, PLATE_ON_BASE).stops.camera).toBe(
      "above",
    );
  });

  it("lets the maker's choice win, even when it equals the default", () => {
    const eye = effectiveKnobs(IN_USE, PLATE_ON_BASE, { camera: "eye" });
    expect(eye.stops.camera).toBe("eye");
    expect(eye.chosen).toEqual(["camera"]);
    expect(eye.why).toEqual({});
    const any = effectiveKnobs(IN_USE, PLATE_ON_BASE, { camera: "any" });
    expect(any.stops.camera).toBe("any");
  });

  it("leaves a steep or absent camera alone", () => {
    expect(
      effectiveKnobs({ camera: "overhead" }, PLATE_ON_BASE).stops.camera,
    ).toBe("overhead");
    expect(effectiveKnobs({ light: "studio" }, PLATE_ON_BASE).stops).toEqual({
      light: "studio",
    });
  });

  it("ignores a choice for a knob the slot does not offer", () => {
    const e = effectiveKnobs({ camera: "eye" }, null, { props: "none" });
    expect(e.offered).toEqual(["camera"]);
    expect(e.stops).toEqual({ camera: "eye" });
  });
});

describe("knobText and knobSummary", () => {
  it("gives each stop's clause, none for 'any'", () => {
    expect(knobText({ camera: "any", light: "studio" })).toEqual({
      light: "soft, even studio light",
    });
  });

  it("names the stops in one line, skipping 'any'", () => {
    expect(knobSummary(effectiveKnobs(IN_USE, PLATE_ON_BASE))).toBe(
      "A little above · medium · window light · a few props",
    );
    expect(
      knobSummary(effectiveKnobs({ camera: "any", distance: "wide" }, null)),
    ).toBe("Wide");
  });
});

describe("reasonMove", () => {
  const at = (stops: Record<string, string>) =>
    effectiveKnobs(stops as never, null);

  it("moves its knob one step", () => {
    expect(reasonMove("top", at({ camera: "eye" }))).toEqual({
      knob: "camera",
      stop: "above",
    });
    expect(reasonMove("small", at({ distance: "wide" }))).toEqual({
      knob: "distance",
      stop: "medium",
    });
    expect(reasonMove("busy", at({ props: "styled" }))).toEqual({
      knob: "props",
      stop: "few",
    });
    expect(reasonMove("harsh", at({ shadow: "strong" }))).toEqual({
      knob: "shadow",
      stop: "soft",
    });
    expect(reasonMove("dark", at({ light: "warm" }))).toEqual({
      knob: "light",
      stop: "studio",
    });
  });

  it("goes from 'any' to its first stop", () => {
    for (const r of ReasonKey.options) {
      const knob = REASONS[r].knob;
      expect(reasonMove(r, at({ [knob]: "any" }))).toEqual({
        knob,
        stop: REASONS[r].fromAny,
      });
    }
  });

  it("stops at the end, and when the slot lacks the knob", () => {
    expect(reasonMove("top", at({ camera: "overhead" }))).toBeNull();
    expect(reasonMove("small", at({ distance: "close" }))).toBeNull();
    expect(reasonMove("busy", at({ props: "none" }))).toBeNull();
    expect(reasonMove("dark", at({ light: "studio" }))).toBeNull();
    expect(reasonMove("top", at({ light: "window" }))).toBeNull();
  });
});

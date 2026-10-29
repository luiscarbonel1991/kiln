import { describe, expect, it } from "vitest";
import { Aspect, DestinationProfile } from "@/domain/destination";
import { offeredDestinations } from "@/domain/plan";
import {
  SEED_DESTINATIONS,
  SEED_RECIPE_PRESETS,
  SEED_SHOT_LISTS,
} from "@/domain/seed";
import { ShotList, ShotSlot, sceneSlots } from "@/domain/shot-list";

const scene = { key: "hero", label: "Hero", purpose: "Win the click." };
const exact = {
  key: "colours",
  label: "Colours",
  purpose: "Every colour at a glance.",
  fill: "exact",
  exact: "colour-grid",
};

describe("ShotSlot", () => {
  it("defaults to a scene slot", () => {
    expect(ShotSlot.parse(scene).fill).toBe("scene");
  });

  it("requires an exact kind on exact slots and forbids it on scene slots", () => {
    expect(() => ShotSlot.parse({ ...exact, exact: undefined })).toThrow();
    expect(() => ShotSlot.parse({ ...scene, exact: "colour-grid" })).toThrow();
    expect(ShotSlot.parse(exact).exact).toBe("colour-grid");
  });

  it("lets only a scene slot offer knobs, with stops that exist", () => {
    expect(
      ShotSlot.parse({ ...scene, knobs: { camera: "eye" } }).knobs,
    ).toEqual({ camera: "eye" });
    expect(() =>
      ShotSlot.parse({ ...exact, knobs: { camera: "eye" } }),
    ).toThrow();
    expect(() =>
      ShotSlot.parse({ ...scene, knobs: { camera: "eyes" } }),
    ).toThrow();
  });

  it("rejects a non kebab-case key and a malformed aspect", () => {
    expect(() => ShotSlot.parse({ ...scene, key: "Hero Shot" })).toThrow();
    expect(() => ShotSlot.parse({ ...scene, aspect: "square" })).toThrow();
  });
});

describe("ShotList", () => {
  const list = {
    id: "l",
    name: "List",
    destinationId: null,
    slots: [scene, exact],
  };

  it("rejects duplicate slot keys", () => {
    expect(() =>
      ShotList.parse({ ...list, slots: [scene, { ...scene }] }),
    ).toThrow();
  });

  it("a line-art list has no knobs", () => {
    const knobbed = { ...scene, knobs: { camera: "eye" } };
    expect(() =>
      ShotList.parse({ ...list, style: "line-art", slots: [knobbed] }),
    ).toThrow();
    expect(
      ShotList.parse({ ...list, slots: [knobbed] }).slots[0].knobs,
    ).toEqual({ camera: "eye" });
  });

  it("sceneSlots keeps only scene slots, in order", () => {
    expect(sceneSlots(ShotList.parse(list)).map((s) => s.key)).toEqual([
      "hero",
    ]);
  });
});

describe("seed catalog integrity", () => {
  it("every destination parses and has unique format keys", () => {
    for (const d of SEED_DESTINATIONS) {
      expect(() => DestinationProfile.parse(d)).not.toThrow();
      const keys = d.formats.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("every shot list targets a known destination (or none)", () => {
    const ids = new Set(SEED_DESTINATIONS.map((d) => d.id));
    for (const l of SEED_SHOT_LISTS) {
      if (l.destinationId !== null) expect(ids.has(l.destinationId)).toBe(true);
      for (const s of l.slots) {
        if (s.aspect) expect(Aspect.safeParse(s.aspect).success).toBe(true);
      }
    }
  });

  it("every preset names a known shot list on that shot list's destination", () => {
    for (const p of SEED_RECIPE_PRESETS) {
      const list = SEED_SHOT_LISTS.find((l) => l.id === p.shotListId);
      expect(list).toBeDefined();
      expect(p.destinationId).toBe(list?.destinationId);
    }
    const ids = SEED_RECIPE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("board seeds", () => {
  const catalog = {
    destinations: SEED_DESTINATIONS,
    shotLists: SEED_SHOT_LISTS,
  };

  it("offers Etsy for listing kits, Instagram for content, both for a launch", () => {
    const ids = (type: "listing-kit" | "content" | "launch") =>
      offeredDestinations(type, catalog).map((d) => d.id);
    expect(ids("listing-kit")).toEqual(["etsy"]);
    expect(ids("content")).toEqual(["instagram"]);
    expect(ids("launch")).toEqual(["etsy", "instagram"]);
  });

  it("the Etsy listing interleaves four exact slots among its five scenes, then its video", () => {
    const etsy = SEED_SHOT_LISTS.find((l) => l.id === "etsy-listing");
    expect(etsy?.slots.map((s) => s.fill)).toEqual([
      "scene",
      "scene",
      "exact",
      "exact",
      "exact",
      "exact",
      "scene",
      "scene",
      "scene",
      "video",
    ]);
  });

  it("the Instagram carousel is a fixed six-slide sequence at 4:5, with a story and a post apart", () => {
    const carousel = SEED_SHOT_LISTS.find((l) => l.id === "instagram-carousel");
    const slides = carousel?.slots.filter((s) => !s.standalone) ?? [];
    expect(slides.map((s) => s.key)).toEqual([
      "hook",
      "in-place",
      "detail",
      "colours",
      "personalize",
      "cta",
    ]);
    expect(slides.every((s) => s.aspect === "4:5")).toBe(true);
    // The other sizes re-frame an approved slide, posted on their own.
    expect(
      carousel?.slots
        .filter((s) => s.standalone)
        .map((s) => [s.key, s.aspect, s.versionOf]),
    ).toEqual([
      ["story", "9:16", "hook"],
      ["post", "1:1", "in-place"],
    ]);
  });

  it("a version re-frames a scene of its list at another aspect, with no knobs", () => {
    const list = (slots: unknown[]) =>
      ShotList.safeParse({
        id: "l",
        name: "L",
        destinationId: "d",
        slots: [
          { key: "hook", label: "Hook", purpose: "p", aspect: "4:5" },
          ...slots,
        ],
      }).success;
    const story = { key: "story", label: "S", purpose: "p", aspect: "9:16" };
    expect(list([{ ...story, versionOf: "hook" }])).toBe(true);
    expect(list([{ ...story, versionOf: "nope" }])).toBe(false);
    expect(list([{ ...story, aspect: "4:5", versionOf: "hook" }])).toBe(false);
    expect(list([{ ...story, fill: "shared", versionOf: "hook" }])).toBe(false);
    expect(
      list([
        { ...story, versionOf: "hook" },
        { ...story, key: "chain", aspect: "1:1", versionOf: "story" },
      ]),
    ).toBe(false);
  });
});

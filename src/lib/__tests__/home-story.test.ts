import { describe, expect, it } from "vitest";
import { ProjectPlan } from "@/domain/plan";
import { Product } from "@/domain/product";
import type { TakeCheck } from "@/domain/qc";
import { SAMPLE_DESIGN, SAMPLE_PRODUCT } from "@/lib/home-sample";
import {
  MAX_SCENES,
  pickShowcase,
  projectStory,
  sampleStory,
} from "@/lib/home-story";
import pkg from "../__fixtures__/product-package.json";

const scene = (key: string, approvedOutput?: string, off = false) => ({
  key,
  label: key,
  purpose: "p",
  aspect: "4:5",
  ...(approvedOutput ? { approvedOutput } : {}),
  ...(off ? { off } : {}),
});

const plan = (destinationId: string, approved: number) => ({
  destinations: [
    {
      destinationId,
      shotListId: "etsy-listing",
      slots: Array.from({ length: Math.max(approved, 1) }, (_, i) =>
        scene(
          `s${i}`,
          i < approved ? `https://store.test/${i}.png` : undefined,
        ),
      ),
    },
  ],
});

describe("the showcase project", () => {
  it("is the one whose sale destination has the most approved scenes", () => {
    expect(
      pickShowcase([
        { id: "newest", plan: plan("etsy", 1) },
        { id: "social", plan: plan("instagram", 5) },
        { id: "most", plan: plan("etsy", 3) },
      ]),
    ).toBe("most");
  });

  it("goes to the newest on a tie, and to the newest planned when none is approved", () => {
    expect(
      pickShowcase([
        { id: "a", plan: plan("etsy", 2) },
        { id: "b", plan: plan("etsy", 2) },
      ]),
    ).toBe("a");
    expect(
      pickShowcase([
        { id: "broken", plan: { destinations: "nope" } },
        { id: "plain", plan: plan("etsy", 0) },
      ]),
    ).toBe("plain");
    expect(pickShowcase([])).toBeNull();
  });
});

describe("the sample story", () => {
  it("tells every chapter with a generic product, for free", () => {
    const story = sampleStory();
    expect(story.project).toBeNull();
    expect(story.product).toMatchObject({
      name: "Engraved family cutting board",
      size: "16 x 10 in",
      finish: "Engraved",
      price: 48,
    });
    expect(story.exact.map((f) => f.view.kind)).toEqual([
      "colour-grid",
      "size-spec",
      "scale",
    ]);
    expect(story.scenes).toEqual([]);
    expect(story.looks.map((l) => l.name)).toEqual([
      "Maple",
      "Walnut",
      "Cherry",
    ]);
    expect(story.words).toMatchObject({ channel: "Etsy", titleMax: 140 });
    expect(story.words?.title).toContain("cutting board");
    expect(story.destinations.map((d) => d.name)).toEqual(
      expect.arrayContaining(["Etsy", "Instagram", "Amazon"]),
    );
    expect(story.destinations.every((d) => !d.used)).toBe(true);
    expect(story.design).toBeNull();
  });

  it("is generic: nothing of a maker's catalog", () => {
    const words =
      /maker1|\bsigns?\b|acrylic|laser|hanger|plaque|house.?numbers?|no.?soliciting/i;
    expect(JSON.stringify(SAMPLE_PRODUCT)).not.toMatch(words);
    expect(JSON.stringify(SAMPLE_DESIGN)).not.toMatch(words);
    expect(JSON.stringify(sampleStory())).not.toMatch(words);
  });
});

describe("a project's story", () => {
  const parsed = pkg.products[0];
  const product = Product.parse({ ...parsed, price: 48 });
  const check: TakeCheck = {
    status: "passed",
    lines: [{ expected: "The Riveras", found: true, how: "read" }],
    problems: [],
    notes: [],
    checkedAt: "2026-11-02T00:00:00Z",
  };
  const projectPlan = ProjectPlan.parse({
    destinations: [
      {
        destinationId: "etsy",
        shotListId: "etsy-listing",
        slots: [
          scene("hero", "https://store.test/hero.png"),
          scene("in-use", "https://store.test/hero.png"),
          scene("gift", "https://stub.local/openai/edit.png"),
          scene("lifestyle", "https://store.test/life.png", true),
          {
            key: "size",
            label: "Size & spec",
            purpose: "p",
            aspect: "1:1",
            fill: "exact",
            exact: "size-spec",
          },
        ],
        listing: {
          title: { value: "Walnut board, carved", source: "maker" },
          description: { value: "One.\n\nTwo.\n\nThree.", source: "spec" },
          tags: { value: ["walnut board"], source: "spec" },
          materials: { value: [], source: "spec" },
          personalization: { value: [], source: "spec" },
        },
      },
      {
        destinationId: "instagram",
        shotListId: "social-launch",
        slots: [scene("post", "https://store.test/post.png")],
      },
    ],
  });

  const story = projectStory({
    project: { id: "p1", name: "Board — Listing kit" },
    product,
    plan: projectPlan,
    brand: null,
    checks: new Map([["https://store.test/hero.png", check]]),
    drafted: ["etsy"],
    design: null,
  });

  it("shows its approved scenes once each, with their check, never a stub or one switched off", () => {
    expect(story.scenes).toEqual([
      {
        url: "https://store.test/hero.png",
        label: "hero",
        aspect: "4:5",
        check: { label: "checked · text 1/1", status: "passed" },
      },
      { url: "https://store.test/post.png", label: "post", aspect: "4:5" },
    ]);
    expect(story.scenes.length).toBeLessThanOrEqual(MAX_SCENES);
  });

  it("deals the destination's own exact frames and tells its saved listing", () => {
    expect(story.exact.map((f) => [f.view.kind, f.label])).toEqual([
      ["size-spec", "Size & spec"],
    ]);
    expect(story.words).toMatchObject({
      channel: "Etsy",
      title: "Walnut board, carved",
      description: "One.\n\nTwo.",
      tags: ["walnut board"],
    });
  });

  it("marks where the project delivers and where Kiln made a draft", () => {
    const etsy = story.destinations.find((d) => d.id === "etsy");
    const instagram = story.destinations.find((d) => d.id === "instagram");
    const amazon = story.destinations.find((d) => d.id === "amazon");
    expect(etsy).toMatchObject({ used: true, drafted: true });
    expect(instagram).toMatchObject({ used: true, drafted: false });
    expect(amazon).toMatchObject({ used: false });
  });
});

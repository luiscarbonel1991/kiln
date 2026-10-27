import { describe, expect, it } from "vitest";
import type { MasterAsset } from "@/domain/master-asset";
import {
  planProject,
  slotState,
  withSlotPlace,
  withSlotTuning,
} from "@/domain/plan";
import { Product } from "@/domain/product";
import { productUnderstanding } from "@/domain/product-understanding";
import { slotCards } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { tuneView } from "@/lib/slot-tune";

const plate = Product.parse({
  id: "prod-t",
  sku: "PT-01",
  name: "Desk plate",
  family: "Desk",
  dimensions: { w: 9, h: 2.78, d: 2.25, unit: "in" },
  shape: "name plate",
  material: "birch plywood",
  treatment: "engraved",
  colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
  defaultColour: "birch",
  typography: { family: "Fraunces" },
  useContexts: ["a desk beside a laptop"],
  parts: [
    { name: "plate", dimensions: { w: 8, h: 2.5, d: 0.14 } },
    { name: "base", lies: "flat", dimensions: { w: 9, h: 0.28, d: 2.25 } },
  ],
  source: { kind: "photo", assetUrl: "https://cdn.example.com/plate.jpg" },
});
const master: MasterAsset = {
  id: "m-1",
  origin: "product",
  sourcePrompt: null,
  assetUrl: "https://cdn.example.com/plate.jpg",
  mime: "image/jpeg",
};
const ref = { destinationId: "etsy", slotKey: "in-use" };

function setup(
  plan = planProject({
    product: plate,
    type: "listing-kit",
    destinationIds: ["etsy"],
    catalog: CATALOG,
  }),
) {
  const slot = plan.destinations[0].slots.find((s) => s.key === "in-use");
  const card = slotCards(plan, master, productUnderstanding(plate), plate).find(
    (c) => c.id === "etsy.in-use",
  );
  if (!slot || !card) throw new Error("no in-use");
  return { plan, slot, card };
}

describe("tuneView", () => {
  it("shows the slot's knobs, their stops and what the model reads", () => {
    const { slot, card } = setup();
    const t = tuneView({
      slot,
      card,
      view: slotState(slot, card),
    });
    expect(t?.summary).toBe("Eye level · medium · window light · a few props");
    expect(t?.knobs.map((k) => [k.key, k.stop, k.chosen])).toEqual([
      ["camera", "eye", false],
      ["distance", "medium", false],
      ["light", "window", false],
      ["shadow", "any", false],
      ["props", "few", false],
    ]);
    expect(t?.knobs[0].stops.map((s) => s.label)).toEqual([
      "Any",
      "Eye level",
      "A little above",
      "From above",
    ]);
    expect(t?.reads?.composition).toMatch(/^eye level or slightly above/);
    expect(t?.locked).toBeNull();
    expect(t?.inert).toEqual({ prompt: false, fields: [] });
  });

  it("marks the maker's own stops", () => {
    const { slot } = setup(
      withSlotTuning(
        planProject({
          product: plate,
          type: "listing-kit",
          destinationIds: ["etsy"],
          catalog: CATALOG,
        }),
        ref,
        { knob: "camera", stop: "above" },
      ),
    );
    const t = tuneView({ slot, view: slotState(slot) });
    expect(t?.knobs[0]).toMatchObject({ stop: "above", chosen: true });
    expect(t?.reads).toBeNull();
  });

  it("locks while queued or approved, and says what keeps the knobs out", () => {
    const { slot, card } = setup();
    const queued = tuneView({
      slot,
      card,
      view: { state: "queued", failed: false, inBatch: true },
    });
    expect(queued?.locked).toBe("In the queue: tune it when it is done.");
    const approved = tuneView({
      slot,
      card,
      view: { state: "approved", failed: false },
    });
    expect(approved?.locked).toBe("Approved: undo the approval to tune it.");
    const edited = tuneView({
      slot,
      card: {
        ...card,
        promptOverride: "my own prompt",
        fields: {
          ...card.fields,
          lighting: { value: "mine", source: "local", locked: false },
        },
      },
      view: slotState(slot, card),
    });
    expect(edited?.inert).toEqual({ prompt: true, fields: ["lighting"] });
  });

  it("nothing for an exact slot or a slot planned before knobs", () => {
    const { plan } = setup();
    const colours = plan.destinations[0].slots.find((s) => s.key === "size");
    if (!colours) throw new Error("no size slot");
    expect(tuneView({ slot: colours, view: slotState(colours) })).toBeNull();
    const { slot } = setup();
    const { knobs: _k, ...old } = slot;
    expect(tuneView({ slot: old, view: slotState(old) })).toBeNull();
  });

  it("a take to review offers what may be off and a new take with its price", () => {
    const { slot, card } = setup();
    const done = {
      ...card,
      status: "done" as const,
      outputs: ["https://x/1.png"],
    };
    const t = tuneView({
      slot,
      card: done,
      view: slotState(slot, done),
    });
    expect(t?.reasons.map((r) => [r.label, r.move])).toEqual([
      ["Can't see its top", { knob: "camera", stop: "above" }],
      ["Product too small", { knob: "distance", stop: "close" }],
      ["Too busy", { knob: "props", stop: "none" }],
      ["Too dark", { knob: "light", stop: "studio" }],
      ["Shadows too strong", { knob: "shadow", stop: "soft" }],
    ]);
    expect(t?.take?.typical).toBeGreaterThan(0);
    expect(t?.take?.max).toBeGreaterThanOrEqual(t?.take?.typical ?? 0);
  });

  it("no reasons and no new take while queued, before a take, or once approved", () => {
    const { slot, card } = setup();
    const done = {
      ...card,
      status: "done" as const,
      outputs: ["https://x/1.png"],
    };
    for (const view of [
      { state: "queued" as const, failed: false, inBatch: true },
      slotState(slot, card),
      { state: "approved" as const, failed: false },
    ]) {
      const t = tuneView({ slot, card: done, view });
      expect(t?.reasons).toEqual([]);
      expect(t?.take).toBeNull();
    }
  });

  it("says why the last take failed, even with an earlier one showing", () => {
    const { slot, card } = setup();
    const done = {
      ...card,
      status: "done" as const,
      outputs: ["https://x/1.png"],
    };
    const job = {
      status: "failed" as const,
      attempt: 2,
      error: "provider timed out",
    };
    const t = tuneView({
      slot,
      card: done,
      view: slotState(slot, done, job),
      job,
    });
    expect(t?.error).toBe("provider timed out");
  });
});

describe("tuneView: the place", () => {
  const places = [
    { place: "a desk beside a laptop", from: "product" as const },
    { place: "a reception counter", from: "brief" as const },
  ];

  it("offers the places to a scene that takes one, its own place shown", () => {
    const { plan, slot, card } = setup();
    expect(
      tuneView({ slot, card, view: slotState(slot, card), places })?.place,
    ).toEqual({ own: null, options: places, putsInPlace: false });
    const placed = withSlotPlace(plan, ref, "a reception counter");
    const own = placed.destinations[0].slots.find((s) => s.key === "in-use");
    if (!own) throw new Error("no in-use");
    expect(
      tuneView({ slot: own, card, view: slotState(own, card), places })?.place
        ?.own,
    ).toBe("a reception counter");
  });

  it("a hero takes a place (it then stands in it); a scene that names none does not", () => {
    const { plan, card } = setup();
    const hero = plan.destinations[0].slots.find((s) => s.key === "hero");
    const gift = plan.destinations[0].slots.find((s) => s.key === "gift");
    if (!hero || !gift) throw new Error("no hero or gift");
    expect(
      tuneView({ slot: hero, card, view: slotState(hero, card), places })?.place
        ?.putsInPlace,
    ).toBe(true);
    expect(
      tuneView({ slot: gift, card, view: slotState(gift, card), places })
        ?.place,
    ).toBeNull();
  });
});

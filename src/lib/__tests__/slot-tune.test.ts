import { describe, expect, it } from "vitest";
import { DOOR_TAG } from "@/domain/__tests__/fixtures/door-tag";
import type { MasterAsset } from "@/domain/master-asset";
import {
  planProject,
  slotState,
  withSlotLook,
  withSlotPlace,
  withSlotTuning,
  withThreeQuarter,
} from "@/domain/plan";
import { Product } from "@/domain/product";
import { slotCards } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { tuneLook, tuneView } from "@/lib/slot-tune";

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
  const card = slotCards(plan, master, plate).find(
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

describe("tuneView with Kiln's view from above", () => {
  const above = {
    assetUrl: "https://cdn.example.com/above.png",
    angleDeg: 30,
    front: master.assetUrl,
  };

  it("names Kiln's pick and the image the next take edits", () => {
    const { plan, slot, card } = setup();
    const viewed = withThreeQuarter(plan, above);
    const view = slotState(slot, card);
    const picked = tuneView({ slot, card, view, above });
    const camera = picked?.knobs.find((k) => k.key === "camera");
    expect(camera).toMatchObject({
      stop: "above",
      picked: true,
      chosen: false,
    });
    expect(picked?.startsFrom).toBe("above");
    expect(picked?.summary).toMatch(/^A little above/);
    expect(viewed.references?.threeQuarter).toEqual(above);
    // Without one, nothing changes.
    const plain = tuneView({ slot, card, view });
    expect(plain?.knobs.find((k) => k.key === "camera")).toMatchObject({
      stop: "eye",
      picked: false,
    });
    expect(plain?.startsFrom).toBeNull();
  });

  it("the maker's eye level starts from the front", () => {
    const tuned = withSlotTuning(setup().plan, ref, {
      knob: "camera",
      stop: "eye",
    });
    const { slot, card } = setup(tuned);
    const tune = tuneView({ slot, card, view: slotState(slot, card), above });
    expect(tune?.knobs.find((k) => k.key === "camera")).toMatchObject({
      stop: "eye",
      chosen: true,
      picked: false,
    });
    expect(tune?.startsFrom).toBe("front");
  });
});

describe("a scene's look in Tune", () => {
  const tagPlan = planProject({
    product: DOOR_TAG,
    type: "listing-kit",
    destinationIds: ["etsy"],
    catalog: CATALOG,
  });
  const scene = (p: typeof tagPlan, key: string) => {
    const found = p.destinations[0].slots.find((s) => s.key === key);
    if (!found) throw new Error(`no ${key}`);
    return found;
  };

  it("offers the project's look, each colour and each style, and marks the scene's own", () => {
    const own = withSlotLook(
      tagPlan,
      { destinationId: "etsy", slotKey: "hero" },
      { colour: "gold-black" },
    );
    expect(tuneLook(DOOR_TAG, own, scene(own, "hero"))).toEqual({
      colours: [
        { key: null, label: "The project's (Black/White)" },
        { key: "black-white", label: "Black/White", face: "#1B1B1B" },
        { key: "gold-black", label: "Gold/Black", face: "#D3B66F" },
      ],
      styles: [
        { key: null, label: "The project's (Quiet please)" },
        { key: "original", label: "Quiet please" },
        { key: "do-not-disturb", label: "Do not disturb" },
      ],
      colour: "gold-black",
      style: null,
      refused: null,
    });
    expect(tuneLook(DOOR_TAG, own, scene(own, "size"))).toBeNull();
  });

  it("offers none for a product in one look, and says why for one not drawn from an SVG", () => {
    const { plan, slot } = setup();
    expect(tuneLook(plate, plan, slot)).toBeNull();
    const photo = Product.parse({
      ...DOOR_TAG,
      styles: undefined,
      source: { kind: "photo", assetUrl: "https://stub.local/tag.png" },
    });
    expect(tuneLook(photo, tagPlan, scene(tagPlan, "hero"))?.refused).toBe(
      "Kiln draws other colours and styles from a design file; this product has none.",
    );
  });
});

describe("a scene whose provider cannot take a paid call", () => {
  it("says why in place of the new take", () => {
    const { plan, slot, card } = setup();
    const taken = {
      ...card,
      status: "done" as const,
      outputs: ["https://x/1.png"],
    };
    const view = slotState(slot, taken);
    const why =
      "Google rejected the API key on its last call: replace GOOGLE_API_KEY.";
    const blocked = tuneView({ slot, card: taken, view, blocked: why });
    expect(blocked?.take).toBeNull();
    expect(blocked?.blocked).toBe(why);
    const open = tuneView({ slot, card: taken, view });
    expect(open?.take).not.toBeNull();
    expect(open?.blocked).toBeNull();
    expect(plan.destinations).toHaveLength(1);
  });
});

describe("a test take", () => {
  it("is offered at the model's low quality, priced, and not on a model without one", () => {
    const { slot, card } = setup();
    const view = slotState(slot, card);
    const gpt = tuneView({
      slot,
      card: {
        ...card,
        model: { ...card.model, provider: "openai", model: "gpt-image-2" },
      },
      view,
    });
    expect(gpt?.testTake?.max).toBeGreaterThan(0);
    expect(gpt?.testTake?.max).toBeLessThan(0.05);
    const gemini = tuneView({
      slot,
      card: {
        ...card,
        model: {
          ...card.model,
          provider: "google",
          model: "gemini-nano-banana-2.1",
        },
      },
      view,
    });
    expect(gemini?.testTake).toBeNull();
    expect(
      tuneView({
        slot,
        card: {
          ...card,
          model: { ...card.model, provider: "openai", model: "gpt-image-2" },
        },
        view,
        blocked: "no key",
      })?.testTake,
    ).toBeNull();
  });
});

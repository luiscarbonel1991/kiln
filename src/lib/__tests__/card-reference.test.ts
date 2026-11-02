import { describe, expect, it } from "vitest";
import { DOOR_TAG } from "@/domain/__tests__/fixtures/door-tag";
import type { MasterAsset } from "@/domain/master-asset";
import {
  planProject,
  withSlotLook,
  withSlotTuning,
  withThreeQuarter,
} from "@/domain/plan";
import { withLookReference } from "@/domain/plan-look";
import { Product } from "@/domain/product";
import { cardReference, slotCamera } from "@/lib/card-reference";
import { CATALOG } from "@/lib/recipes";

const product = Product.parse({
  id: "prod-1",
  sku: "DP-1",
  name: "Desk plate on a base",
  family: "Office",
  dimensions: { w: 8, h: 2.5, unit: "in" },
  shape: "rectangular plate on a base",
  material: "maple plywood",
  treatment: "engraved",
  colours: [{ key: "maple", name: "Maple", face: "#E8D2A6" }],
  defaultColour: "maple",
  typography: { family: "Fraunces" },
  source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
});
const master: MasterAsset = {
  id: "plate-prod-1",
  origin: "product",
  sourcePrompt: null,
  assetUrl: "https://stub.local/front.png",
  mime: "image/png",
};
const view = {
  assetUrl: "https://stub.local/above.png",
  angleDeg: 30,
  front: master.assetUrl,
};
const plain = planProject({
  product,
  type: "listing-kit",
  destinationIds: ["etsy"],
  catalog: CATALOG,
});
const plan = withThreeQuarter(plain, view);
const slot = (p: typeof plan, key: string) => {
  const found = p.destinations[0].slots.find((s) => s.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
};

describe("the camera a scene applies", () => {
  it("is Kiln's pick, a little above, once the view from above applies", () => {
    expect(
      slotCamera(plain, slot(plain, "in-use"), master.assetUrl, product),
    ).toBe("eye");
    expect(
      slotCamera(plan, slot(plan, "in-use"), master.assetUrl, product),
    ).toBe("above");
    expect(slotCamera(plan, slot(plan, "hero"), master.assetUrl, product)).toBe(
      "above",
    );
    expect(
      slotCamera(plan, slot(plan, "detail"), master.assetUrl, product),
    ).toBe(undefined);
  });

  it("the maker's stop wins over Kiln's pick", () => {
    const tuned = withSlotTuning(
      plan,
      { destinationId: "etsy", slotKey: "in-use" },
      { knob: "camera", stop: "eye" },
    );
    expect(
      slotCamera(tuned, slot(tuned, "in-use"), master.assetUrl, product),
    ).toBe("eye");
    expect(cardReference(tuned, "etsy.in-use", master, product)).toBe(master);
  });
});

describe("the image a scene card edits", () => {
  it("the view from above for a camera looking down, the front for the rest", () => {
    expect(cardReference(plan, "etsy.hero", master, product).assetUrl).toBe(
      view.assetUrl,
    );
    expect(cardReference(plan, "etsy.in-use", master, product).assetUrl).toBe(
      view.assetUrl,
    );
    // The macro has no camera: it keeps the front.
    expect(cardReference(plan, "etsy.detail", master, product)).toBe(master);
    expect(cardReference(plan, "etsy.nowhere", master, product)).toBe(master);
    expect(cardReference(plain, "etsy.hero", master, product)).toBe(master);
  });

  it("a reference the maker uploaded replaces both views", () => {
    const own = {
      ...master,
      id: "m-own",
      assetUrl: "https://stub.local/mine.jpg",
    };
    expect(cardReference(plan, "etsy.hero", own, product)).toBe(own);
  });

  it("a frame in a look of its own edits the plate Kiln drew for that look, and that look's view from above", () => {
    const gold = {
      colour: "gold-black",
      design: "https://stub.local/gold.svg",
      front: "https://stub.local/gold.png",
      threeQuarter: {
        assetUrl: "https://stub.local/gold-above.png",
        angleDeg: 30,
        front: "https://stub.local/gold.png",
      },
    };
    const tag = withSlotLook(
      withLookReference(
        withThreeQuarter(
          planProject({
            product: DOOR_TAG,
            type: "listing-kit",
            destinationIds: ["etsy"],
            catalog: CATALOG,
          }),
          view,
        ),
        gold,
      ),
      { destinationId: "etsy", slotKey: "detail" },
      { colour: "gold-black" },
    );
    const eyeLevel = cardReference(tag, "etsy.detail", master, DOOR_TAG);
    expect(eyeLevel.assetUrl).toBe(gold.front);
    expect(eyeLevel.id).toBe(master.id);
    const above = withSlotLook(
      tag,
      { destinationId: "etsy", slotKey: "hero" },
      { colour: "gold-black" },
    );
    expect(cardReference(above, "etsy.hero", master, DOOR_TAG).assetUrl).toBe(
      gold.threeQuarter.assetUrl,
    );
    // The project's own frames keep the project's reference and view.
    expect(cardReference(above, "etsy.in-use", master, DOOR_TAG).assetUrl).toBe(
      view.assetUrl,
    );
  });
});

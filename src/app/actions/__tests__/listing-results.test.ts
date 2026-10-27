import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectPlan } from "@/domain/plan";

const saveRead = vi.fn(async (_input: unknown) => ({}));
const readFromShop = vi.fn(async (_input: unknown) => ({}));
const changed: ProjectPlan[] = [];
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/server/listing-results", async (original) => ({
  ...(await original<typeof import("@/server/listing-results")>()),
  saveRead,
  readFromShop,
}));
vi.mock("@/server/project-repository", () => ({
  changePlan: async (_id: string, change: (p: ProjectPlan) => ProjectPlan) => {
    const { planProject } = await import("@/domain/plan");
    const { CATALOG } = await import("@/lib/recipes");
    const { Product } = await import("@/domain/product");
    const plan = planProject({
      product: Product.parse({
        id: "p",
        sku: "S",
        name: "Coaster",
        family: "Home",
        dimensions: { w: 4, h: 4, unit: "in" },
        shape: "round coaster",
        material: "birch plywood",
        treatment: "engraved",
        colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
        defaultColour: "birch",
        typography: { family: "Fraunces" },
        source: { kind: "photo", assetUrl: "https://stub.local/c.png" },
      }),
      type: "launch",
      destinationIds: ["etsy"],
      catalog: CATALOG,
    });
    const next = change(plan);
    changed.push(next);
    return next;
  },
}));

const actions = await import("@/app/actions/listing-results");
const where = { projectId: "p", destinationId: "etsy" };

afterEach(() => {
  vi.clearAllMocks();
  changed.length = 0;
});

describe("the results panel's actions", () => {
  it("a typed read is kept as typed; removing one changes the plan", async () => {
    expect(
      await actions.saveReadAction({
        ...where,
        key: "day14",
        read: { visits: 12, source: "Etsy stats" },
      }),
    ).toBeUndefined();
    expect(saveRead).toHaveBeenCalledWith({
      ...where,
      key: "day14",
      read: { visits: 12, source: "Etsy stats" },
      source: "typed",
    });
    await actions.saveReadAction({ ...where, key: "day14", read: null });
    expect(changed[0].destinations[0].results).toEqual({ reads: {} });
    expect(
      await actions.saveReadAction({ ...where, key: "day7", read: null }),
    ).toEqual({ error: "The read could not be read." });
  });

  it("the shop's refusal comes back in words", async () => {
    readFromShop.mockRejectedValueOnce(
      new Error("Add the listing's address first."),
    );
    expect(
      await actions.readFromShopAction({ ...where, key: "before" }),
    ).toEqual({ error: "Add the listing's address first." });
  });

  it("keeps an https address and the day the photos went up; only for a sale destination", async () => {
    await actions.setListingUrlAction({
      ...where,
      url: " https://www.etsy.com/listing/4413933723/x ",
    });
    expect(changed[0].destinations[0].listingUrl).toBe(
      "https://www.etsy.com/listing/4413933723/x",
    );
    expect(
      await actions.setListingUrlAction({
        ...where,
        url: "http://www.etsy.com/listing/1",
      }),
    ).toEqual({ error: "Paste the listing's https address." });
    await actions.setLiveOnAction({ ...where, liveOn: "2026-10-27" });
    expect(changed[1].destinations[0].results?.liveOn).toBe("2026-10-27");
    expect(
      await actions.setLiveOnAction({ ...where, liveOn: "27/10" }),
    ).toEqual({ error: "Pick a day (YYYY-MM-DD)." });
    expect(
      await actions.setFollowingAction({
        projectId: "p",
        destinationId: "instagram",
        following: false,
      }),
    ).toEqual({
      error:
        '"instagram" is not a sale destination: only a listing has results.',
    });
  });
});

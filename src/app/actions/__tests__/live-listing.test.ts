import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketBrief } from "@/domain/market-brief";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import type { ProjectPlan } from "@/domain/plan";
import { parseProductPackage } from "@/domain/product-package";
import pkg from "../../../lib/__fixtures__/product-package.json";

const parsed = parseProductPackage(pkg);
if (!parsed.ok) throw new Error("fixture package does not parse");
const board = { ...parsed.products[0], id: "prod-1" };

const storeAsset = vi.fn(
  async (_bytes: Uint8Array, mime: string, prefix: string) =>
    `https://storage.test/${prefix}/a.${mime.split("/")[1]}`,
);
const created: { plan: ProjectPlan }[] = [];
const redirect = vi.fn();

vi.mock("@/providers/asset-bytes", () => ({
  storeAsset,
  isAllowedAssetUrl: (url: string) => url.startsWith("https://storage.test/"),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/server/product-repository", () => ({
  getProduct: async (id: string) => (id === board.id ? board : null),
}));
vi.mock("@/server/product-reference", () => ({
  productReference: async () => null,
}));
const remembered: Record<string, "sweep" | "place"> = {};
const rememberHeroSetting = vi.fn(
  async (_destinationId: string, _family: string, _setting: string) => {},
);
vi.mock("@/server/maker-repository", () => ({
  getMakerModels: async () => DEFAULT_MAKER_MODELS,
  getMakerPreferences: async () => ({ heroSetting: remembered }),
  rememberHeroSetting,
}));
const briefs: Record<string, { brief: MarketBrief; projectName: string }> =
  {};
vi.mock("@/server/project-repository", () => ({
  createProject: async (input: { plan: ProjectPlan }) => {
    created.push(input);
    return "project-1";
  },
  latestBriefs: async () => briefs,
}));

const { uploadListingPhotoAction } = await import("@/app/actions/live-listing");
const { createProjectAction } = await import("@/app/actions/new-project");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const form = (file: File) => {
  const data = new FormData();
  data.set("file", file);
  return data;
};
const URL = "https://www.etsy.com/listing/4413933723/engraved-board";
const live = (
  photos: { url: string; aspect: string; replaceWith?: string }[],
) => ({
  productId: board.id,
  type: "listing-kit",
  destinationIds: ["etsy"],
  live: { listingUrl: URL, photos },
});
const stored = (n: number, replaceWith?: string) => ({
  url: `https://storage.test/listings/p${n}.jpg`,
  aspect: "4:3",
  ...(replaceWith ? { replaceWith } : {}),
});

afterEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  for (const key of Object.keys(remembered)) delete remembered[key];
  for (const key of Object.keys(briefs)) delete briefs[key];
});

describe("uploadListingPhotoAction", () => {
  it("stores the photo by its bytes and answers its size and proportions", async () => {
    const result = await uploadListingPhotoAction(
      form(new File([PNG], "hero.png", { type: "image/png" })),
    );
    expect(result).toEqual({
      url: "https://storage.test/listings/a.png",
      aspect: "1:1",
      width: 1,
      height: 1,
    });
    expect(storeAsset).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "image/png",
      "listings",
      { byContent: true },
    );
  });

  it("refuses what is not a PNG, JPEG or WebP whatever it is called, and over 15 MB", async () => {
    const svg = await uploadListingPhotoAction(
      form(new File(["<svg/>"], "hero.png", { type: "image/png" })),
    );
    expect(svg).toEqual({
      error: "hero.png: add the listing's photo as a PNG, JPEG or WebP.",
    });
    const big = await uploadListingPhotoAction(
      form(new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.jpg")),
    );
    expect(big).toEqual({ error: "big.jpg is larger than 15 MB." });
    expect(storeAsset).not.toHaveBeenCalled();
  });
});

describe("createProjectAction from a live listing", () => {
  it("rebuilds the plan from the listing's photos and keeps its address", async () => {
    const result = await createProjectAction(
      live([stored(1, "hero"), stored(2), stored(3, "size")]),
    );
    expect(result).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith("/projects/project-1");
    const [etsy] = created[0].plan.destinations;
    expect(etsy.listingUrl).toBe(URL);
    expect(etsy.slots.map((s) => [s.key, s.fill])).toEqual([
      ["hero", "scene"],
      ["live-2", "photo"],
      ["size", "exact"],
    ]);
  });

  it("refuses another type, two destinations, a photo not in Kiln's storage and a frame the product cannot have", async () => {
    const one = [stored(1, "hero")];
    expect(await createProjectAction({ ...live(one), type: "launch" })).toEqual(
      { error: "A live listing refreshes one sale destination." },
    );
    expect(
      await createProjectAction({
        ...live(one),
        destinationIds: ["etsy", "shopify"],
      }),
    ).toEqual({ error: "A live listing refreshes one sale destination." });
    for (const url of [
      "data:image/png;base64,AAAA",
      "https://elsewhere.test/p1.jpg",
    ]) {
      expect(
        await createProjectAction(
          live([{ url, aspect: "1:1", replaceWith: "hero" }]),
        ),
      ).toEqual({ error: "Add the listing's photos here first, then start." });
    }
    const frame = await createProjectAction(live([stored(1, "nope")]));
    expect(frame).toEqual({
      error: expect.stringContaining('"nope" is not a frame'),
    });
    expect(created).toEqual([]);
  });

  it("refuses an address that is not https", async () => {
    expect(
      await createProjectAction({
        ...live([stored(1, "hero")]),
        live: {
          listingUrl: "http://etsy.com/listing/1",
          photos: [stored(1, "hero")],
        },
      }),
    ).toEqual({ error: "Pick a product, a type and a destination." });
  });
});

describe("createProjectAction: the hero's setting", () => {
  const start = (heroSettings?: Record<string, string>) =>
    createProjectAction({
      productId: board.id,
      type: "listing-kit",
      destinationIds: ["etsy"],
      ...(heroSettings ? { heroSettings } : {}),
    });
  const heroOf = () =>
    created[0].plan.destinations[0].slots.find((s) => s.key === "hero")?.knobs
      ?.setting;

  it("takes the maker's choice from the plan step, and remembers it for the family", async () => {
    await start({ etsy: "place" });
    expect(heroOf()).toBe("place");
    expect(rememberHeroSetting).toHaveBeenCalledWith(
      "etsy",
      board.family,
      "place",
    );
  });

  it("keeps an accepted proposal a proposal: nothing is remembered", async () => {
    await start({ etsy: "sweep" });
    expect(heroOf()).toBe("sweep");
    expect(rememberHeroSetting).not.toHaveBeenCalled();
  });

  it("without a choice, takes Kiln's proposal: the remembered one first", async () => {
    remembered[`etsy:${board.family.toLowerCase()}`] = "place";
    await start();
    expect(heroOf()).toBe("place");
    created.length = 0;
    delete remembered[`etsy:${board.family.toLowerCase()}`];
    await start();
    expect(heroOf()).toBe("sweep");
  });

  it("refuses a setting it does not know", async () => {
    expect(await start({ etsy: "spotlight" })).toEqual({
      error: "Pick a product, a type and a destination.",
    });
  });
});

describe("createProjectAction: the market brief", () => {
  it("each destination starts from the product's last brief there, named where it came from", async () => {
    const brief = MarketBrief.parse({
      searches: [
        { term: "cutting board", source: "typed", readOn: "2026-10-01" },
      ],
    });
    briefs.etsy = { brief, projectName: "Board — Listing kit" };
    briefs.amazon = { brief, projectName: "Elsewhere" };
    await createProjectAction({
      productId: board.id,
      type: "listing-kit",
      destinationIds: ["etsy"],
    });
    const [etsy, ...rest] = created[0].plan.destinations;
    expect(etsy.brief).toEqual({
      ...brief,
      carriedFrom: "Board — Listing kit",
    });
    expect(rest).toEqual([]);
  });
});

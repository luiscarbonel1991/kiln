import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import { parseProductPackage } from "@/domain/product-package";
import pkg from "../../../lib/__fixtures__/product-package.json";

// plan_project, create_project, deliver and import_products on stubbed
// repositories: the same plan New project would start, and refusals in words.

const parsed = parseProductPackage(pkg);
if (!parsed.ok) throw new Error("fixture package does not parse");
const product = parsed.products[0];

const s = vi.hoisted(() => ({ started: [] as unknown[] }));
vi.mock("@/server/product-repository", () => ({
  getProduct: async (id: string) => (id === product.id ? product : null),
  listProducts: async () => [product],
}));
vi.mock("@/server/maker-repository", () => ({
  getMakerPreferences: async () => ({ heroSetting: {} }),
  getMakerModels: async () => DEFAULT_MAKER_MODELS,
  rememberHeroSetting: async () => {},
  getCurrentMaker: async () => ({ id: "m1" }),
}));
vi.mock("@/server/project-repository", () => ({
  latestBriefs: async () => ({}),
  createProject: async (input: unknown) => {
    s.started.push(input);
    return "p9";
  },
}));
vi.mock("@/server/product-reference", () => ({
  productReference: async () => null,
  threeQuarterReference: async () => null,
}));
vi.mock("@/server/project-frames", () => ({
  framedProjects: async () => [],
  projectFrames: async (id: string) => ({
    project: { id, name: "Kit", type: "listing-kit", phase: "plan" },
    frames: [],
  }),
  waitingProjectFrames: async () => [],
}));
vi.mock("@/server/deliver/deliver-destination", () => ({
  deliverDestination: async (project: string) =>
    project === "p1"
      ? { url: "https://stub.local/kit.zip", filename: "kit.zip", count: 7 }
      : { error: "Approve the hero first." },
}));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const CTX = { tokenId: "t1", tokenName: "agent", canSpend: false };
const call = (name: string, args: unknown) => callTool(TOOLS, name, args, CTX);

afterEach(() => {
  s.started.length = 0;
});

describe("plan_project", () => {
  it("lists the frames a listing kit would start with, saving nothing", async () => {
    const answer = await call("plan_project", {
      product: product.id,
      type: "listing-kit",
      destinations: ["etsy"],
    });
    if (!answer.ok) throw new Error(answer.error);
    const data = answer.output.data as {
      destinations: {
        destination: string;
        frames: { frame: string; fill: string }[];
      }[];
      scenes: number;
    };
    expect(data.destinations[0].destination).toBe("etsy");
    expect(data.destinations[0].frames.map((f) => f.frame)).toContain(
      "etsy.hero",
    );
    expect(data.scenes).toBeGreaterThan(0);
    expect(s.started).toEqual([]);
  });

  it("refuses an unknown product", async () => {
    expect(
      await call("plan_project", {
        product: "nope",
        type: "listing-kit",
        destinations: ["etsy"],
      }),
    ).toEqual({ ok: false, error: "No product of yours has that id." });
  });
});

describe("create_project", () => {
  it("starts the project New project would, and answers its frames", async () => {
    const answer = await call("create_project", {
      product: product.id,
      type: "listing-kit",
      destinations: ["etsy"],
      off: ["etsy.gift"],
    });
    expect(answer).toMatchObject({
      ok: true,
      output: { data: { project: "p9" } },
    });
    expect(s.started).toHaveLength(1);
  });

  it("refuses a design project: it starts in the studio", async () => {
    expect(
      await call("create_project", {
        product: product.id,
        type: "design",
        destinations: ["etsy"],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("deliver", () => {
  it("answers the zip's link, or the refusal in words", async () => {
    expect(
      await call("deliver", { project: "p1", destination: "etsy" }),
    ).toMatchObject({
      ok: true,
      output: { data: { url: "https://stub.local/kit.zip", count: 7 } },
    });
    expect(
      await call("deliver", { project: "p2", destination: "etsy" }),
    ).toEqual({
      ok: false,
      error: "Approve the hero first.",
    });
  });
});

describe("import_products", () => {
  it("refuses what does not read as a package", async () => {
    expect(
      await call("import_products", { package: { products: "no" } }),
    ).toMatchObject({
      ok: false,
    });
  });
});

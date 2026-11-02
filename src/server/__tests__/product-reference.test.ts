import { afterEach, describe, expect, it, vi } from "vitest";

const render = vi.hoisted(() => ({
  result: null as null | {
    assetUrl: string;
    mime: "image/png";
    angleDeg: number;
  },
  fail: false,
  calls: 0,
}));
vi.mock("@/providers/plates/three-quarter", () => ({
  renderThreeQuarter: async () => {
    render.calls++;
    if (render.fail) throw new Error("resvg failed");
    return render.result;
  },
}));
// Storage stubbed: what Kiln stores is kept in memory.
const storage = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/providers/asset-bytes", async (original) => {
  const real = await original<typeof import("@/providers/asset-bytes")>();
  return {
    ...real,
    fetchAsset: async (url: string) => {
      const bytes = storage.get(url);
      if (!bytes) return real.fetchAsset(url);
      return {
        bytes: Buffer.from(bytes),
        base64: "",
        mime: url.endsWith(".svg") ? "image/svg+xml" : "image/png",
      };
    },
    storeAsset: async (bytes: Uint8Array, mime: string, prefix: string) => {
      const url = `https://stub.local/${prefix}/${storage.size}.${mime === "image/svg+xml" ? "svg" : "png"}`;
      storage.set(url, bytes);
      return url;
    },
  };
});

const { lookedReference, redrawnLooks } = await import(
  "@/server/product-reference"
);
const { Product } = await import("@/domain/product");
const { DOOR_TAG } = await import("@/domain/__tests__/fixtures/door-tag");
const { CUTTING_BOARD } = await import(
  "@/domain/__tests__/fixtures/cutting-board"
);

const photoProduct = Product.parse({
  ...CUTTING_BOARD,
  source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
});
const black = { colour: "black-white", style: null };
const gold = { colour: "gold-black", style: null };

afterEach(() => {
  render.result = null;
  render.fail = false;
  render.calls = 0;
});

describe("lookedReference", () => {
  it("a photo product's reference is its photo, in any look", async () => {
    const { master, drawn } = await lookedReference(photoProduct, {
      colour: "walnut",
      style: null,
    });
    expect(master?.assetUrl).toBe("https://stub.local/front.png");
    expect(drawn).toBeNull();
    expect(
      await lookedReference(CUTTING_BOARD, { colour: "maple", style: null }),
    ).toEqual({ master: null, drawn: null });
  });

  it("a vector product's is Kiln's plate in the look, with its view from above", async () => {
    render.result = {
      assetUrl: "https://stub.local/plates/above.png",
      mime: "image/png",
      angleDeg: 30,
    };
    const { master, drawn } = await lookedReference(DOOR_TAG, gold);
    expect(master).toMatchObject({
      id: "plate-pkg:DT-01",
      origin: "product",
      assetUrl: drawn?.front,
      mime: "image/png",
    });
    expect(drawn).toMatchObject({
      colour: "gold-black",
      threeQuarter: {
        assetUrl: "https://stub.local/plates/above.png",
        angleDeg: 30,
        front: drawn?.front,
      },
    });
  });

  it("draws the plate without a view from above when that drawing fails", async () => {
    render.fail = true;
    const { master, drawn } = await lookedReference(DOOR_TAG, black);
    expect(master?.assetUrl).toBe(drawn?.front);
    expect(drawn).not.toHaveProperty("threeQuarter");
  });
});

describe("redrawnLooks", () => {
  it("draws every other look again, leaving out one the product no longer offers", async () => {
    const stale = {
      design: "https://stub.local/old.svg",
      front: "https://stub.local/old.png",
    };
    const plan = {
      destinations: [],
      references: {
        looks: [
          { colour: "black-white", ...stale },
          { colour: "gold-black", style: "do-not-disturb", ...stale },
          { colour: "copper", ...stale },
        ],
      },
    };
    const looks = await redrawnLooks(DOOR_TAG, plan as never, black);
    expect(looks.map((l) => [l.colour, l.style])).toEqual([
      ["gold-black", "do-not-disturb"],
    ]);
    expect(looks[0].front).not.toBe(stale.front);
  });
});

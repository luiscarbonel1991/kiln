import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const upsertProducts = vi.fn(async (products: { sku: string }[]) =>
  products.map((p) => ({ ...p, id: `db-${p.sku}` })),
);
const storeAsset = vi.fn(async (_bytes: Uint8Array, mime: string) =>
  mime === "image/svg+xml"
    ? "http://storage.test/products/d.svg"
    : "http://storage.test/products/p.png",
);

vi.mock("@/server/product-repository", () => ({
  upsertProducts,
  listProducts: async () => [],
}));
vi.mock("@/providers/asset-bytes", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storeAsset,
}));

const { createProductAction, importProductsAction, uploadProductFileAction } =
  await import("@/app/actions/products");

const hasMagick = (() => {
  try {
    execFileSync("magick", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

// A 200 x 100 drawing (2:1) in two colours.
const DESIGN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><script>alert(1)</script><rect x="50" y="50" width="200" height="100" fill="#5B3A29"/><circle cx="150" cy="100" r="20" fill="#D9B98C" onclick="x()"/></svg>`;
const dataSvg = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const form = {
  name: "Walnut wall art",
  whatItIs: "wall art",
  width: 8,
  height: 4,
  unit: "in",
  material: "walnut",
  treatment: "engraved",
  colours: [{ name: "Walnut", hex: "#5B3A29" }],
};

afterEach(() => vi.clearAllMocks());

describe("uploadProductFileAction", () => {
  it("stores a design cleaned, with its colours and proportions", async () => {
    const data = new FormData();
    data.set(
      "file",
      new File([DESIGN], "design.svg", { type: "image/svg+xml" }),
    );
    const result = await uploadProductFileAction(data);
    expect(result).toMatchObject({
      kind: "vector",
      url: "http://storage.test/products/d.svg",
      colours: [
        { name: "Brown", hex: "#5B3A29" },
        { name: "Beige", hex: "#D9B98C" },
      ],
      drawnWidthPx: 200,
      ratio: 2,
    });
    const stored = new TextDecoder().decode(storeAsset.mock.calls[0][0]);
    expect(stored).not.toContain("script");
    expect(stored).not.toContain("onclick");
  });

  it.skipIf(!hasMagick)(
    "stores a photo with its dominant colours",
    async () => {
      const png = execFileSync("magick", [
        "-size",
        "8x8",
        "xc:#2F4A3A",
        "png:-",
      ]);
      const data = new FormData();
      data.set("file", new File([png], "piece.png", { type: "image/png" }));
      const result = await uploadProductFileAction(data);
      expect(result).toMatchObject({
        kind: "photo",
        url: "http://storage.test/products/p.png",
        colours: [{ hex: "#2F4A3A" }],
      });
    },
  );

  it("refuses anything else in words", async () => {
    const data = new FormData();
    data.set("file", new File(["hi"], "notes.txt", { type: "text/plain" }));
    expect(await uploadProductFileAction(data)).toEqual({
      error: "Use a photo (PNG, JPEG, WebP) or an SVG design.",
    });
    data.set("file", new File(["<html/>"], "x.svg", { type: "image/svg+xml" }));
    expect(await uploadProductFileAction(data)).toEqual({
      error: "That file is not an SVG drawing.",
    });
  });
});

describe("createProductAction", () => {
  it("saves a product typed in, with nothing else to fill", async () => {
    const result = await createProductAction(form);
    expect("product" in result && result.product).toMatchObject({
      name: "Walnut wall art",
      sku: expect.stringMatching(/^walnut-wall-art-[a-z0-9]+$/),
      defaultColour: "walnut",
      source: { kind: "form" },
    });
    expect(upsertProducts).toHaveBeenCalledOnce();
  });

  it("a design drawn to its size gets its outline measured and its scale", async () => {
    const result = await createProductAction({
      ...form,
      file: { kind: "vector", url: dataSvg(DESIGN), drawnWidthPx: 200 },
    });
    expect("product" in result && result.product.source).toMatchObject({
      kind: "vector",
      scalePxPerUnit: 25,
      outlineBox: { x: 1 / 6, y: 0.25, w: 2 / 3, h: 0.5 },
    });
    expect("warning" in result).toBe(false);
  });

  it("a design that does not match the size is saved and reported", async () => {
    const result = await createProductAction({
      ...form,
      height: 8,
      file: { kind: "vector", url: dataSvg(DESIGN) },
    });
    expect(result).toMatchObject({
      warning: expect.stringContaining("its SVG's drawing is 2.00:1"),
    });
  });

  it("refuses an incomplete form, or a file outside Kiln's storage", async () => {
    expect(await createProductAction({ ...form, colours: [] })).toEqual({
      error: "Add at least one colour.",
    });
    expect(
      await createProductAction({
        ...form,
        file: { kind: "photo", url: "http://169.254.169.254/p.png" },
      }),
    ).toEqual({
      error: "That file is not in Kiln's storage; upload it again.",
    });
    expect(upsertProducts).not.toHaveBeenCalled();
  });
});

describe("importProductsAction", () => {
  it("moves an inline (data:) photo to storage, so it can be the scenes' reference", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    const product = {
      id: "x",
      sku: "PH-01",
      name: "Photo test",
      family: "Home",
      dimensions: { w: 4, h: 4 },
      shape: "coaster",
      material: "slate",
      treatment: "engraved",
      colours: [{ key: "grey", name: "Grey", face: "#555555" }],
      defaultColour: "grey",
      typography: { family: "Hanken Grotesk" },
      source: {
        kind: "photo",
        assetUrl: `data:image/png;base64,${png.toString("base64")}`,
      },
    };
    const result = await importProductsAction(product);
    expect(result.ok).toBe(true);
    expect(upsertProducts.mock.calls[0][0][0]).toMatchObject({
      source: { kind: "photo", assetUrl: "http://storage.test/products/p.png" },
    });
  });
});

describe("draftProductAction", () => {
  const photo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  it("says why it could not fill the form, and offers the other provider with its price", async () => {
    const { draftProductAction } = await import("@/app/actions/products");
    expect(await draftProductAction({ assetUrl: photo })).toMatchObject({
      degraded: {
        provider: "openai",
        model: "gpt-6.1-sol",
        message: "OpenAI has no API key (OPENAI_API_KEY is not set).",
        alternative: {
          provider: "google",
          model: "gemini-3.5-flash",
          usd: 0.024,
        },
      },
    });
  });

  it("needs a photo in Kiln's storage", async () => {
    const { draftProductAction } = await import("@/app/actions/products");
    expect(
      await draftProductAction({ assetUrl: "http://169.254.169.254/x.png" }),
    ).toEqual({ error: "Upload the photo first." });
  });
});

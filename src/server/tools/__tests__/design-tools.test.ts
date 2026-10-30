import { afterEach, describe, expect, it, vi } from "vitest";

// The design tools on stubbed services: a design's drawings read, a drawing
// or its vector shown as an image, and a trace kept as the drawing's vector
// only while the drawing still shows the take traced.

const s = vi.hoisted(() => ({
  traced: [] as unknown[][],
  vectors: [] as unknown[][],
  stillShown: true,
  traceError: null as string | null,
}));

const drawings = [
  {
    card: "recipe-line-art-0",
    label: "Outline",
    state: "drawn",
    lineArt: "https://stub.local/outline.png",
  },
  {
    card: "recipe-line-art-1",
    label: "Detail",
    state: "vectorized",
    lineArt: "https://stub.local/detail.png",
    vector: "https://stub.local/detail.svg",
  },
  { card: "recipe-line-art-2", label: "Badge", state: "to-draw" },
  { card: "recipe-line-art-3", label: "Minimal", state: "drawing" },
];

vi.mock("@/server/designs", () => ({
  makeProductHref: (url: string) =>
    `/projects/new?design=${encodeURIComponent(url)}`,
  listDesigns: async () => [
    {
      id: "d1",
      name: "Fern",
      updatedAt: "2026-10-30T00:00:00.000Z",
      drawings: 4,
      drawn: 2,
      vectorized: 1,
    },
  ],
  designView: async (id: string) =>
    id === "d1"
      ? {
          project: { id: "d1", name: "Fern", updatedAt: "" },
          master: "https://stub.local/fern.png",
          subject: "a fern leaf",
          drawings,
        }
      : null,
}));
vi.mock("@/server/vectorize", async () => {
  const { z } = await import("zod");
  return {
    VectorMode: z.enum(["outline", "centerline"]),
    VectorDetail: z.enum(["fine", "balanced", "clean"]),
    traceToVector: async (...args: unknown[]) => {
      s.traced.push(args);
      return s.traceError
        ? { error: s.traceError }
        : { url: "https://stub.local/new.svg", shapes: 12, bytes: 3400 };
    },
  };
});
vi.mock("@/server/project-repository", () => ({
  setCardVector: async (...args: unknown[]) => {
    s.vectors.push(args);
    return s.stillShown;
  },
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async (url: string) => {
    const bytes = url.endsWith(".svg")
      ? Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1h8v8H1z"/></svg>',
        )
      : Buffer.from([137, 80, 78, 71]);
    return {
      bytes,
      base64: bytes.toString("base64"),
      mime: url.endsWith(".svg") ? "image/svg+xml" : "image/png",
    };
  },
}));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const CTX = { tokenId: "t1", tokenName: "agent", canSpend: false };
const call = (name: string, args: unknown) => callTool(TOOLS, name, args, CTX);

afterEach(() => {
  s.traced.length = 0;
  s.vectors.length = 0;
  s.stillShown = true;
  s.traceError = null;
});

describe("list_designs and get_design", () => {
  it("list the maker's designs, and read one with what to do next", async () => {
    expect(await call("list_designs", {})).toMatchObject({
      ok: true,
      output: { data: { designs: [{ id: "d1", drawn: 2, vectorized: 1 }] } },
    });
    expect(await call("get_design", { project: "d1" })).toMatchObject({
      ok: true,
      output: {
        data: {
          subject: "a fern leaf",
          drawings: expect.arrayContaining([
            expect.objectContaining({ label: "Detail", state: "vectorized" }),
          ]),
          next: '1 drawing has no line art: quote "draw", then draw.',
        },
      },
    });
    expect(await call("get_design", { project: "p1" })).toEqual({
      ok: false,
      error: "No design of yours has that id.",
    });
  });
});

describe("view_design", () => {
  it("shows the line art as it is, and the vector rendered as a PNG", async () => {
    const art = await call("view_design", {
      project: "d1",
      card: "recipe-line-art-0",
    });
    expect(art).toMatchObject({
      ok: true,
      output: { images: [{ mimeType: "image/png" }] },
    });
    const vector = await call("view_design", {
      project: "d1",
      card: "recipe-line-art-1",
      show: "vector",
    });
    expect(vector).toMatchObject({
      ok: true,
      output: {
        data: { show: "vector", url: "https://stub.local/detail.svg" },
        images: [{ mimeType: "image/png" }],
      },
    });
    if (!vector.ok) return;
    const png = Buffer.from(vector.output.images?.[0].data ?? "", "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("says what is missing", async () => {
    expect(
      await call("view_design", {
        project: "d1",
        card: "recipe-line-art-0",
        show: "vector",
      }),
    ).toEqual({ ok: false, error: "Outline has no vector yet: vectorize it." });
    expect(
      await call("view_design", { project: "d1", card: "recipe-line-art-9" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a drawing"),
    });
  });
});

describe("vectorize", () => {
  it("traces the drawing's take and keeps it as its vector, for that take", async () => {
    const answer = await call("vectorize", {
      project: "d1",
      card: "recipe-line-art-0",
      detail: "clean",
    });
    expect(answer).toMatchObject({
      ok: true,
      output: {
        data: {
          vector: "https://stub.local/new.svg",
          mode: "outline",
          detail: "clean",
          shapes: 12,
          makeProduct: `/projects/new?design=${encodeURIComponent("https://stub.local/new.svg")}`,
        },
      },
    });
    expect(s.traced).toEqual([
      ["https://stub.local/outline.png", "outline", "clean"],
    ]);
    expect(s.vectors).toEqual([
      [
        "d1",
        "recipe-line-art-0",
        "https://stub.local/outline.png",
        "https://stub.local/new.svg",
      ],
    ]);
  });

  it("refuses a drawing with no line art, a failed trace, and a take that changed", async () => {
    expect(
      await call("vectorize", { project: "d1", card: "recipe-line-art-2" }),
    ).toEqual({
      ok: false,
      error: 'Badge has no line art yet: quote "draw", then draw.',
    });
    expect(
      await call("vectorize", { project: "d1", card: "recipe-line-art-3" }),
    ).toEqual({
      ok: false,
      error: "Minimal is being drawn: vectorize it once it lands.",
    });
    s.traceError = "Could not trace this image: bad bytes";
    expect(
      await call("vectorize", { project: "d1", card: "recipe-line-art-0" }),
    ).toEqual({ ok: false, error: "Could not trace this image: bad bytes" });
    s.traceError = null;
    s.stillShown = false;
    expect(
      await call("vectorize", { project: "d1", card: "recipe-line-art-0" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed while it was traced"),
    });
  });

  it("takes no model and no free-form trace settings", async () => {
    expect(
      await call("vectorize", {
        project: "d1",
        card: "recipe-line-art-0",
        filterSpeckle: 40,
      }),
    ).toMatchObject({ ok: false });
    expect(s.traced).toEqual([]);
  });
});

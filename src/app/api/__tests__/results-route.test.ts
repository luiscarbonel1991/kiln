import { describe, expect, it, vi } from "vitest";

// The results routes without a database: the token check and the server's
// results are stubbed (listing-results.db.test.ts covers them).
const auth = vi.hoisted(() => ({ ok: true }));
vi.mock("@/server/access-tokens", async (original) => ({
  ...(await original<typeof import("@/server/access-tokens")>()),
  verifyAccessToken: async () =>
    auth.ok ? { tokenId: "t1", makerId: "m1" } : null,
}));
const calls = vi.hoisted(() => ({ saved: [] as unknown[] }));
vi.mock("@/server/listing-results", async (original) => {
  const real = await original<typeof import("@/server/listing-results")>();
  return {
    ...real,
    saveRead: async (
      _maker: unknown,
      input: {
        projectId: string;
        destinationId: string;
        read: Record<string, unknown>;
      },
    ) => {
      calls.saved.push(input);
      if (input.projectId === "gone") throw new Error("project not found");
      if (input.destinationId === "instagram") {
        throw new real.ResultsRefusal(
          '"instagram" is not a sale destination: only a listing has results.',
        );
      }
      if (input.read.visits === 2.5) {
        throw new real.ResultsRefusal(
          "Visits must be a whole number of 0 or more.",
        );
      }
      return { ...input.read, source: "API" };
    },
    followedListings: async () => [
      {
        projectId: "p1",
        projectName: "Coaster listing kit",
        productName: "Coaster",
        family: "Home",
        destinationId: "etsy",
        destinationName: "Etsy",
        view: {
          listingUrl: "https://www.etsy.com/listing/4413933723/x",
          listingId: "4413933723",
          deliveredOn: "2026-10-01",
          liveOn: "2026-10-01",
          liveOnSet: false,
          following: true,
          reads: [
            {
              key: "before",
              label: "Before",
              read: null,
              window: { from: "2026-09-01", to: "2026-09-30" },
              dueOn: "2026-10-01",
              due: true,
            },
          ],
          comparison: null,
          changed: [{ key: "hero", label: "Marketplace hero" }],
          next: { key: "day30", dueOn: "2026-10-31" },
        },
      },
      {
        projectId: "p2",
        projectName: "Stopped",
        productName: null,
        family: null,
        destinationId: "etsy",
        destinationName: "Etsy",
        view: { following: false, reads: [], changed: [] },
      },
    ],
  };
});

const { GET } = await import("@/app/api/results/route");
const { PUT } = await import(
  "@/app/api/projects/[id]/results/[destinationId]/[read]/route"
);
const { newToken } = await import("@/server/access-tokens");

const TOKEN = newToken().token;
const put = (
  [id, destinationId, read]: [string, string, string],
  body: string,
) =>
  PUT(
    new Request(
      `http://kiln.test/api/projects/${id}/results/${destinationId}/${read}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body,
      },
    ),
    { params: Promise.resolve({ id, destinationId, read }) },
  );

describe("GET /api/results", () => {
  it("lists the followed listings with the reads due and their windows", async () => {
    const res = await GET(
      new Request("http://kiln.test/api/results", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toMatchObject({
      projectId: "p1",
      listingId: "4413933723",
      due: [
        {
          read: "before",
          window: { from: "2026-09-01", to: "2026-09-30" },
        },
      ],
      next: { read: "day30", dueOn: "2026-10-31" },
      changed: ["Marketplace hero"],
      comparison: null,
    });
  });

  it("needs a token", async () => {
    auth.ok = false;
    const res = await GET(
      new Request("http://kiln.test/api/results", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    auth.ok = true;
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/projects/:id/results/:destinationId/:read", () => {
  it("keeps a read, the source defaulting to the API", async () => {
    const res = await put(
      ["p1", "etsy", "before"],
      JSON.stringify({ visits: 40, orders: 2 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      read: { visits: 40, orders: 2, source: "API" },
    });
    expect(calls.saved.at(-1)).toMatchObject({
      projectId: "p1",
      destinationId: "etsy",
      key: "before",
      source: "API",
    });
  });

  it("says what is wrong, with the status that fits", async () => {
    const status = async (
      where: [string, string, string],
      body = '{"visits":3}',
    ) => (await put(where, body)).status;
    expect(await status(["p1", "etsy", "day7"])).toBe(404);
    expect(await status(["gone", "etsy", "before"])).toBe(404);
    expect(await status(["p1", "instagram", "before"])).toBe(404);
    expect(await status(["p1", "etsy", "day14"], "not json")).toBe(400);
    expect(await status(["p1", "etsy", "day14"], '{"from":"yesterday"}')).toBe(
      422,
    );
    const bad = await put(["p1", "etsy", "day14"], '{"visits":2.5}');
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({
      error: "Visits must be a whole number of 0 or more.",
    });
  });
});

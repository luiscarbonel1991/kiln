import { describe, expect, it, vi } from "vitest";

// The frames routes without a database: the token check, the frames and the
// approval are stubbed (project-frames.db.test.ts covers them).
const auth = vi.hoisted(() => ({ ok: true }));
vi.mock("@/server/access-tokens", async (original) => ({
  ...(await original<typeof import("@/server/access-tokens")>()),
  verifyAccessToken: async () =>
    auth.ok ? { tokenId: "t1", makerId: "m1" } : null,
}));
const calls = vi.hoisted(() => ({ approvals: [] as unknown[][] }));
vi.mock("@/server/project-frames", () => ({
  framedProjects: async () => [
    {
      id: "p1",
      name: "Coaster listing kit",
      type: "listing-kit",
      phase: "generation",
      updatedAt: "2026-10-29T12:00:00.000Z",
    },
  ],
  projectFrames: async (id: string) =>
    id === "p1"
      ? {
          project: { id, name: "Coaster", type: "listing-kit", phase: "x" },
          frames: [
            {
              frame: "etsy.hero",
              destinationId: "etsy",
              slotKey: "hero",
              state: "approved",
              output: "https://x/hero-2.png",
              approvedOutput: "https://x/hero-2.png",
            },
          ],
        }
      : null,
}));
vi.mock("@/server/project-repository", async () => {
  const { SlotRefusal } = await import("@/domain/plan");
  return {
    setSlotApproval: async (
      projectId: string,
      ref: { destinationId: string; slotKey: string },
      approved: boolean,
      checked?: string,
    ) => {
      calls.approvals.push([projectId, ref, approved, checked]);
      if (projectId === "gone") throw new Error("project not found");
      if (ref.slotKey === "nope") {
        throw new SlotRefusal("missing", 'no slot "nope" on "etsy"');
      }
      if (ref.slotKey === "size") {
        throw new SlotRefusal("refused", "exact slots need no approval");
      }
      if (checked === "https://x/hero-1.png") {
        throw new SlotRefusal(
          "stale",
          "A newer take landed since: https://x/hero-2.png. Check it, then approve that one.",
        );
      }
    },
  };
});

const projects = await import("@/app/api/projects/route");
const frames = await import("@/app/api/projects/[id]/frames/route");
const approval = await import(
  "@/app/api/projects/[id]/frames/[destinationId]/[slotKey]/approval/route"
);
const { newToken } = await import("@/server/access-tokens");

const TOKEN = newToken().token;
const request = (path: string, method = "GET", body?: string) =>
  new Request(`http://kiln.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}` },
    body,
  });
const decide = (
  method: "PUT" | "DELETE",
  [id, destinationId, slotKey]: [string, string, string],
  body?: string,
) =>
  approval[method](
    request(
      `/api/projects/${id}/frames/${destinationId}/${slotKey}/approval`,
      method,
      body,
    ),
    { params: Promise.resolve({ id, destinationId, slotKey }) },
  );

describe("GET /api/projects and /api/projects/:id/frames", () => {
  it("lists the projects with frames, and a project's frames", async () => {
    const list = await projects.GET(request("/api/projects"));
    expect(list.status).toBe(200);
    expect((await list.json()).projects[0]).toMatchObject({ id: "p1" });
    const res = await frames.GET(request("/api/projects/p1/frames"), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).frames[0]).toMatchObject({ frame: "etsy.hero" });
    const gone = await frames.GET(request("/api/projects/gone/frames"), {
      params: Promise.resolve({ id: "gone" }),
    });
    expect(gone.status).toBe(404);
  });

  it("needs a token", async () => {
    auth.ok = false;
    const res = await projects.GET(request("/api/projects"));
    const put = await decide("PUT", ["p1", "etsy", "hero"]);
    auth.ok = true;
    expect(res.status).toBe(401);
    expect(put.status).toBe(401);
  });
});

describe("PUT and DELETE .../frames/:destinationId/:slotKey/approval", () => {
  it("approves the take the caller checked, and answers the frame", async () => {
    const res = await decide(
      "PUT",
      ["p1", "etsy", "hero"],
      JSON.stringify({ output: "https://x/hero-2.png" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).frame).toMatchObject({
      frame: "etsy.hero",
      approvedOutput: "https://x/hero-2.png",
    });
    expect(calls.approvals.at(-1)).toEqual([
      "p1",
      { destinationId: "etsy", slotKey: "hero" },
      true,
      "https://x/hero-2.png",
    ]);
  });

  it("approves the latest take with no body, and withdraws", async () => {
    expect((await decide("PUT", ["p1", "etsy", "hero"])).status).toBe(200);
    expect(calls.approvals.at(-1)?.[3]).toBeUndefined();
    expect((await decide("DELETE", ["p1", "etsy", "hero"])).status).toBe(200);
    expect(calls.approvals.at(-1)?.[2]).toBe(false);
  });

  it("says what is wrong, with the status that fits", async () => {
    const status = async (where: [string, string, string], body?: string) =>
      (await decide("PUT", where, body)).status;
    expect(await status(["gone", "etsy", "hero"])).toBe(404);
    expect(await status(["p1", "etsy", "nope"])).toBe(404);
    expect(await status(["p1", "etsy", "size"])).toBe(422);
    expect(await status(["p1", "etsy", "hero"], "not json")).toBe(400);
    expect(await status(["p1", "etsy", "hero"], '{"output":""}')).toBe(422);
    const stale = await decide(
      "PUT",
      ["p1", "etsy", "hero"],
      JSON.stringify({ output: "https://x/hero-1.png" }),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/A newer take landed/);
  });
});

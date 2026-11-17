import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

// /api/mcp driven by the MCP SDK's own client, with the route as its fetch:
// the token check, the origin check and the read tools, with the repositories
// stubbed (their DB suites cover them).

const auth = vi.hoisted(() => ({ ok: true }));
vi.mock("@/server/access-tokens", async (original) => ({
  ...(await original<typeof import("@/server/access-tokens")>()),
  verifyAccessToken: async () =>
    auth.ok
      ? { tokenId: "t1", makerId: "m1", name: "agent", canSpend: false }
      : null,
}));
const recorded = vi.hoisted(() => [] as unknown[]);
vi.mock("@/server/tool-calls", async () => {
  const { callTool } = await import("@/server/tools/registry");
  return {
    callAndRecord: async (
      tools: Parameters<typeof callTool>[0],
      name: string,
      args: unknown,
      ctx: Parameters<typeof callTool>[3],
    ) => {
      const answer = await callTool(tools, name, args, ctx);
      recorded.push({ name, ctx, ok: answer.ok });
      return answer;
    },
  };
});
vi.mock("@/server/project-frames", () => ({
  framedProjects: async () => [
    {
      id: "p1",
      name: "Planter listing kit",
      type: "listing-kit",
      phase: "generation",
      updatedAt: "2026-10-29T12:00:00.000Z",
    },
  ],
  projectFrames: async (id: string) =>
    id === "p1"
      ? {
          project: { id, name: "Planter", type: "listing-kit", phase: "x" },
          frames: [
            {
              frame: "etsy.hero",
              destinationId: "etsy",
              slotKey: "hero",
              label: "Hero",
              fill: "scene",
              state: "to-review",
              failed: false,
              output: "https://x/hero-2.png",
              approvedOutput: null,
              approvable: true,
            },
            {
              frame: "etsy.size",
              destinationId: "etsy",
              slotKey: "size",
              label: "Size",
              fill: "exact",
              state: "exact",
              failed: false,
              output: null,
              approvedOutput: null,
              approvable: false,
            },
          ],
        }
      : null,
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async () => ({
    bytes: Buffer.from("png"),
    base64: Buffer.from("png").toString("base64"),
    mime: "image/png",
  }),
}));

const { POST, GET } = await import("@/app/api/mcp/route");

const TOKEN = `kiln_pat_${"a".repeat(43)}`;
const URL_ = "http://127.0.0.1:3009/api/mcp";

const route = (headers: Record<string, string> = {}) =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    for (const [k, v] of Object.entries(headers)) request.headers.set(k, v);
    return POST(request);
  }) as typeof fetch;

async function connect(headers: Record<string, string> = {}) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(URL_), {
      fetch: route(headers),
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  return client;
}

afterEach(() => {
  auth.ok = true;
});

describe("/api/mcp", () => {
  it("initializes and lists the tools, each input an object schema", async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe("kiln");
    expect(client.getInstructions()).toContain("view_frame");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_projects", "get_frames", "view_frame"]),
    );
    const frames = tools.find((t) => t.name === "get_frames");
    expect(frames?.inputSchema).toMatchObject({
      type: "object",
      required: ["project"],
    });
    expect(frames?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("calls a tool and answers its data as text and structured content", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "get_frames",
      arguments: { project: "p1" },
    });
    expect(result.isError).toBeFalsy();
    expect(recorded.at(-1)).toEqual({
      name: "get_frames",
      ctx: {
        tokenId: "t1",
        makerId: "m1",
        tokenName: "agent",
        canSpend: false,
      },
      ok: true,
    });
    expect(result.structuredContent).toMatchObject({
      project: { id: "p1" },
      frames: [
        { frame: "etsy.hero", state: "to-review" },
        { frame: "etsy.size" },
      ],
    });
  });

  it("shows a take as an image, and refuses an exact frame in words", async () => {
    const client = await connect();
    const seen = await client.callTool({
      name: "view_frame",
      arguments: { project: "p1", frame: "etsy.hero" },
    });
    expect(seen.content).toEqual(
      expect.arrayContaining([
        { type: "image", data: "cG5n", mimeType: "image/png" },
      ]),
    );
    const exact = await client.callTool({
      name: "view_frame",
      arguments: { project: "p1", frame: "etsy.size" },
    });
    expect(exact.isError).toBe(true);
    expect(exact.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("is exact") }),
    ]);
  });

  it("answers a bad input and an unknown project as tool errors", async () => {
    const client = await connect();
    const bad = await client.callTool({
      name: "view_frame",
      arguments: { project: "p1", frame: "hero" },
    });
    expect(bad.isError).toBe(true);
    const gone = await client.callTool({
      name: "get_frames",
      arguments: { project: "nope" },
    });
    expect(gone.content).toEqual([
      expect.objectContaining({
        text: "No project of yours with frames has that id.",
      }),
    ]);
  });

  it("refuses a request without a valid token, and one from a foreign page", async () => {
    auth.ok = false;
    await expect(connect()).rejects.toThrow();
    auth.ok = true;
    const foreign = await POST(
      new Request(URL_, {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(foreign.status).toBe(403);
    await expect(
      connect({ Origin: "http://localhost:3009" }),
    ).resolves.toBeDefined();
  });

  it("answers a call without initialize, as `kiln call` sends it", async () => {
    const res = await POST(
      new Request(URL_, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_projects", arguments: {} },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 1,
      result: { structuredContent: { projects: [{ id: "p1" }] } },
    });
  });

  it("keeps no session: GET is not served", async () => {
    expect((await GET()).status).toBe(405);
  });
});

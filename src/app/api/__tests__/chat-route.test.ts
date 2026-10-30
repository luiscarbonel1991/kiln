import { describe, expect, it, vi } from "vitest";

// The chat's routes without a database or a model: the turn, the stored
// conversation and Stop are stubbed (src/server/chat covers them).
const turns = vi.hoisted(() => ({ asked: [] as unknown[] }));
vi.mock("@/server/chat/run-turn", () => {
  class TurnRefusal extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    TurnRefusal,
    runTurn: async (input: { sessionId: string }) => {
      turns.asked.push(input);
      if (input.sessionId === "busy") {
        throw new TurnRefusal("A turn is running in this conversation.", 409);
      }
      return new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    },
    stopTurn: (id: string) => id === "s1",
  };
});
vi.mock("@/server/chat/chat-repository", () => ({
  getChat: async (id: string) =>
    id === "s1"
      ? { id, title: "Hi", projectId: null, running: false, messages: [] }
      : null,
}));

const chat = await import("@/app/api/chat/route");
const one = await import("@/app/api/chat/[id]/route");
const stop = await import("@/app/api/chat/[id]/stop/route");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { host: "localhost:3000", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/chat", () => {
  it("runs a turn and answers its stream", async () => {
    const response = await chat.POST(
      post({ sessionId: "s1", message: { id: "u1" }, plan: true }),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(turns.asked.at(-1)).toEqual({
      sessionId: "s1",
      message: { id: "u1" },
      plan: true,
    });
  });

  it("refuses a page on another origin, a body it cannot read, and a busy session", async () => {
    expect(
      (
        await chat.POST(
          post({ sessionId: "s1" }, { origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect((await chat.POST(post("not json"))).status).toBe(400);
    const busy = await chat.POST(post({ sessionId: "busy", message: {} }));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      error: "A turn is running in this conversation.",
    });
  });
});

describe("GET /api/chat/:id and POST /api/chat/:id/stop", () => {
  it("reads a conversation, and stops its turn", async () => {
    expect(
      await (await one.GET(new Request("http://x"), params("s1"))).json(),
    ).toMatchObject({ id: "s1", running: false });
    expect(
      (await one.GET(new Request("http://x"), params("nope"))).status,
    ).toBe(404);
    const stopped = await stop.POST(
      new Request("http://localhost:3000/api/chat/s1/stop", { method: "POST" }),
      params("s1"),
    );
    expect(await stopped.json()).toEqual({ stopped: true });
    expect(
      (
        await stop.POST(
          new Request("http://localhost:3000/api/chat/x/stop", {
            method: "POST",
          }),
          params("nope"),
        )
      ).status,
    ).toBe(404);
  });
});

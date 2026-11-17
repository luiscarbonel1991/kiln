import { afterEach, describe, expect, it, vi } from "vitest";

// list_lessons and propose_lesson on a stubbed lessons module
// (lessons.db.test.ts covers it): what each asks for, and what it answers.

const s = vi.hoisted(() => ({
  listed: [] as unknown[],
  proposed: [] as unknown[],
}));

vi.mock("@/server/lessons", () => ({
  listLessons: async (_maker: unknown, filter: unknown) => {
    s.listed.push(filter);
    return [
      { id: "l1", text: "Kitchen, Etsy's Hero: the camera a little above." },
    ];
  },
  proposeLesson: async (_maker: unknown, input: { text: string }) => {
    s.proposed.push(input);
    return { id: "l2", status: "proposed", ...input };
  },
}));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const CTX = {
  maker: { id: "test" },
  tokenId: "t1",
  tokenName: "agent",
  canSpend: false,
};
const call = (name: string, args: unknown) => callTool(TOOLS, name, args, CTX);

afterEach(() => {
  s.listed.length = 0;
  s.proposed.length = 0;
});

describe("list_lessons", () => {
  it("reads the kept lessons by default, for a family and a topic", async () => {
    expect(
      await call("list_lessons", { family: "Kitchen", topic: "scenes" }),
    ).toMatchObject({
      ok: true,
      output: { data: { lessons: [{ id: "l1" }] } },
    });
    expect(await call("list_lessons", { status: "proposed" })).toMatchObject({
      ok: true,
    });
    expect(s.listed).toEqual([
      { status: ["kept"], family: "Kitchen", topics: ["scenes"] },
      { status: ["proposed"], topics: null },
    ]);
  });
});

describe("propose_lesson", () => {
  it("proposes one sentence for the maker to keep, and refuses a status", async () => {
    expect(
      await call("propose_lesson", {
        topic: "listing",
        text: "Titles lead with the wood, never with the word gift.",
        family: "Kitchen",
      }),
    ).toMatchObject({
      ok: true,
      output: { data: { lesson: { id: "l2", status: "proposed" } } },
    });
    expect(
      await call("propose_lesson", {
        topic: "listing",
        text: "Keep it short.",
        status: "kept",
      }),
    ).toMatchObject({ ok: false });
    expect(s.proposed).toHaveLength(1);
  });
});

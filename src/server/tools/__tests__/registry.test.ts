import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/server/generation-repository", () => ({
  QueueRefusal: class QueueRefusal extends Error {},
}));

const { TOOLS } = await import("@/server/tools");
const { callTool, defineTool, inputJsonSchema, ToolRefusal } = await import(
  "@/server/tools/registry"
);

const CTX = {
  maker: { id: "test" },
  tokenId: "t1",
  tokenName: "agent",
  canSpend: false,
};
// The tool list itself: names a client can call, inputs it can read, and no
// tool that lets an agent pick a model (agents ask for roles).

function keys(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  return Object.entries(schema).flatMap(([key, value]) => [
    ...(key === "properties" && value && typeof value === "object"
      ? Object.keys(value)
      : []),
    ...keys(value),
  ]);
}

describe("the tools", () => {
  it("each has a unique snake_case name, a description and an object input", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description.length).toBeGreaterThan(30);
      expect(inputJsonSchema(tool)).toMatchObject({ type: "object" });
    }
  });

  it("no tool takes a model: a task runs on its role's route", () => {
    const offenders = TOOLS.filter((t) =>
      keys(inputJsonSchema(t)).some((k) => /model|provider/i.test(k)),
    ).map((t) => t.name);
    expect(offenders).toEqual([]);
  });
});

describe("callTool", () => {
  const echo = defineTool({
    name: "echo",
    title: "Echo",
    description: "Answers what it was given, or refuses.",
    input: z.object({ word: z.string().min(2) }),
    hints: { readOnly: true },
    run: async ({ word }) => {
      if (word === "no") throw new ToolRefusal("Refused in words.");
      if (word === "boom") throw new Error("disk on fire");
      return { data: { word } };
    },
  });

  it("parses the input before running", async () => {
    expect(await callTool([echo], "echo", { word: "hi" }, CTX)).toEqual({
      ok: true,
      output: { data: { word: "hi" } },
    });
    expect(await callTool([echo], "echo", { word: 1 }, CTX)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^echo needs: word:/),
    });
  });

  it("answers an unknown tool, a refusal and a failure in words", async () => {
    expect(await callTool([echo], "nope", {}, CTX)).toEqual({
      ok: false,
      error: 'Kiln has no tool named "nope".',
    });
    expect(await callTool([echo], "echo", { word: "no" }, CTX)).toEqual({
      ok: false,
      error: "Refused in words.",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await callTool([echo], "echo", { word: "boom" }, CTX)).toEqual({
      ok: false,
      error: "echo failed: disk on fire",
    });
  });
});

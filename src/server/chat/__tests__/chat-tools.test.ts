import { describe, expect, it, vi } from "vitest";
import { TOOLS } from "@/server/tools";

const recorded: unknown[] = [];
vi.mock("@/server/tool-calls", () => ({
  callAndRecord: async (
    _tools: unknown,
    name: string,
    args: unknown,
    ctx: unknown,
  ) => {
    recorded.push({ name, args, ctx });
    return name === "get_frames"
      ? { ok: false, error: "No project of yours with frames has that id." }
      : { ok: true, output: { data: { ok: 1 } } };
  },
}));

const { chatTools, LEFT_OUT, modelOutput, NEEDS_CLICK, ToolRefused } =
  await import("@/server/chat/chat-tools");
const { withoutImageData } = await import("@/server/chat/messages");

const CTX = {
  tokenId: null,
  tokenName: "Chat",
  canSpend: true,
  sessionId: "s1",
};

describe("the chat's tools", () => {
  it("are Kiln's tools, less a file import and the maker's own reads", () => {
    const names = Object.keys(chatTools(CTX, { id: "kiln", tools: null }));
    expect(names).toEqual([
      ...TOOLS.map((t) => t.name).filter((n) => !LEFT_OUT.has(n)),
      "suggest_specialist",
    ]);
    for (const name of NEEDS_CLICK) expect(names).toContain(name);
  });

  it("record each call with its session, and a refusal reaches the model in words", async () => {
    const tools = chatTools(CTX, { id: "kiln", tools: null });
    const run = (name: string, input: unknown) =>
      tools[name].execute?.(input, { toolCallId: "c1", messages: [] } as never);
    await expect(run("list_projects", {})).resolves.toEqual({ ok: 1 });
    await expect(run("get_frames", { project: "p" })).rejects.toThrow(
      ToolRefused,
    );
    expect(recorded[0]).toMatchObject({ name: "list_projects", ctx: CTX });
  });

  it("a take is sent as an image once; stored, it is named instead", () => {
    const output = {
      frame: "etsy.hero",
      output: "https://kiln/x.png",
      images: [{ mimeType: "image/png", data: "AAAA" }],
    };
    expect(modelOutput(output)).toEqual({
      type: "content",
      value: [
        {
          type: "text",
          text: JSON.stringify({
            frame: "etsy.hero",
            output: "https://kiln/x.png",
          }),
        },
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: "AAAA" },
        },
      ],
    });
    const stored = withoutImageData({
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-view_frame",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output,
        },
      ],
    });
    const kept = (stored.parts[0] as { output: typeof output }).output;
    expect(kept.images).toEqual([{ mimeType: "image/png" }]);
    expect(modelOutput(kept).value[1]).toMatchObject({ type: "text" });
    expect(modelOutput({ queued: 5 })).toEqual({
      type: "json",
      value: { queued: 5 },
    });
  });
});

describe("the chat's approval card", () => {
  it("shows a quote's cost for every tool that spends", async () => {
    const { PAID } = await import("@/components/chat/chat-parts");
    expect([...PAID].sort()).toEqual(
      NEEDS_CLICK.filter((t) => t !== "approve_frame" && t !== "deliver").sort(),
    );
  });
});

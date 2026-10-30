import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/server/chat/no-gateway";

afterEach(() => vi.unstubAllGlobals());

describe("no gateway", () => {
  it("a model named by a string is refused before any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      generateText({ model: "openai/gpt-6-luna", prompt: "hola" }),
    ).rejects.toThrow(/No such languageModel|NoSuchModel/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

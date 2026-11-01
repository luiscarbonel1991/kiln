import { describe, expect, it, vi } from "vitest";

// Each provider's model list, every page of it, as ids.
const googleModels = [
  { name: "models/gemini-omni-1.1-flash" },
  { name: "models/gemini-nano-banana-2.1" },
  {},
];
vi.mock("@/providers/google/client", () => ({
  getGenAI: () => ({
    models: {
      list: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield* googleModels;
        },
      })),
    },
  }),
}));
vi.mock("@/providers/openai/client", () => ({
  getOpenAI: () => ({
    models: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield { id: "gpt-image-2" };
          yield { id: "sora-2" };
        },
      }),
    },
  }),
}));

const { checkGoogleKey } = await import("@/providers/google/key-check");
const { checkOpenAIKey } = await import("@/providers/openai/key-check");

describe("the key checks' model lists", () => {
  it("names Google's models without their prefix", async () => {
    expect(await checkGoogleKey()).toEqual([
      "gemini-omni-1.1-flash",
      "gemini-nano-banana-2.1",
    ]);
  });

  it("names OpenAI's models", async () => {
    expect(await checkOpenAIKey()).toEqual(["gpt-image-2", "sora-2"]);
  });
});

import { describe, expect, it, vi } from "vitest";

const constructed: unknown[] = [];

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor(options: unknown) {
      constructed.push(options);
    }
  },
}));
vi.mock("../../env", () => ({
  env: { KILN_PROVIDERS: "live", GOOGLE_API_KEY: "k" },
}));

const { getGenAI } = await import("@/providers/google/client");

describe("google client", () => {
  it("sets no retryOptions, so the SDK never repeats a paid request", () => {
    getGenAI();
    expect(constructed).toEqual([{ apiKey: "k" }]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// The key check without a network: the adapters' model lists are stubbed.
const env = vi.hoisted(() => ({
  KILN_PROVIDERS: "live" as "live" | "mock",
  OPENAI_API_KEY: "sk-test" as string | undefined,
  GOOGLE_API_KEY: "g-test" as string | undefined,
}));
vi.mock("../../env", () => ({ env }));
const lists = vi.hoisted(() => ({
  openai: vi.fn(async (): Promise<string[]> => []),
  google: vi.fn(async (): Promise<string[]> => []),
}));
vi.mock("@/providers/openai/key-check", () => ({
  checkOpenAIKey: lists.openai,
}));
vi.mock("@/providers/google/key-check", () => ({
  checkGoogleKey: lists.google,
}));

const { checkProviderKey } = await import("@/providers/key-check");

beforeEach(() => {
  env.KILN_PROVIDERS = "live";
  env.OPENAI_API_KEY = "sk-test";
  env.GOOGLE_API_KEY = "g-test";
  lists.openai.mockReset().mockResolvedValue(["gpt-image-2"]);
  lists.google.mockReset().mockResolvedValue(["gemini-omni-1.1-flash"]);
});

describe("checkProviderKey", () => {
  it("a key the provider takes is ok with the models it lists, and only that provider is called", async () => {
    expect(await checkProviderKey("google")).toEqual({
      ok: true,
      called: true,
      models: ["gemini-omni-1.1-flash"],
    });
    expect(lists.google).toHaveBeenCalledTimes(1);
    expect(lists.openai).not.toHaveBeenCalled();
  });

  it("a rejected key says so in the provider's words", async () => {
    lists.google.mockRejectedValue(
      Object.assign(
        new Error(
          '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
        ),
        { status: 400 },
      ),
    );
    expect(await checkProviderKey("google")).toEqual({
      ok: false,
      called: true,
      message:
        "Google rejected the API key (400) — check GOOGLE_API_KEY or use OpenAI.",
    });
    lists.openai.mockRejectedValue(
      Object.assign(new Error("Incorrect API key provided"), { status: 401 }),
    );
    expect(await checkProviderKey("openai")).toMatchObject({
      ok: false,
      called: true,
      message: expect.stringContaining("OpenAI rejected the API key"),
    });
  });

  it("calls nothing without a key, or in mock mode", async () => {
    env.GOOGLE_API_KEY = undefined;
    expect(await checkProviderKey("google")).toEqual({
      ok: false,
      called: false,
      message: "No API key — set GOOGLE_API_KEY in .env and restart Kiln.",
    });
    env.KILN_PROVIDERS = "mock";
    expect(await checkProviderKey("openai")).toMatchObject({
      ok: false,
      called: false,
    });
    expect(lists.google).not.toHaveBeenCalled();
    expect(lists.openai).not.toHaveBeenCalled();
  });
});

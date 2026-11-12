import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  KILN_PROVIDERS: "live" as const,
  OPENAI_API_KEY: undefined as string | undefined,
  GOOGLE_API_KEY: "g-env" as string | undefined,
}));
vi.mock("../../env", () => ({ env }));

const { hasProviderKey, providerKey, providerKeySource, setProviderKey } =
  await import("@/providers/keys");
const { getOpenAI, hasOpenAIKey } = await import("@/providers/openai/client");

afterEach(() => {
  setProviderKey("openai", null);
  setProviderKey("google", null);
});

describe("provider keys", () => {
  it("a key the maker saved wins over the environment's, which comes back when it is removed", () => {
    expect(providerKeySource("google")).toBe("env");
    setProviderKey("google", "g-saved");
    expect(providerKey("google")).toBe("g-saved");
    expect(providerKeySource("google")).toBe("saved");
    setProviderKey("google", null);
    expect(providerKey("google")).toBe("g-env");
  });

  it("no key anywhere is no key, and the client refuses before any request", () => {
    expect(hasProviderKey("openai")).toBe(false);
    expect(providerKeySource("openai")).toBeNull();
    expect(hasOpenAIKey()).toBe(false);
    expect(() => getOpenAI()).toThrow(/OpenAI has no API key/);
  });

  it("a replaced key builds a new client; the same key keeps its client", () => {
    setProviderKey("openai", "sk-one-1234567890");
    const first = getOpenAI();
    expect(getOpenAI()).toBe(first);
    setProviderKey("openai", "sk-two-1234567890");
    const second = getOpenAI();
    expect(second).not.toBe(first);
    expect(second.apiKey).toBe("sk-two-1234567890");
  });
});

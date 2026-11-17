import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  KILN_PROVIDERS: "live" as const,
  OPENAI_API_KEY: undefined as string | undefined,
  GOOGLE_API_KEY: "g-env" as string | undefined,
}));
vi.mock("../../env", () => ({ env }));

const {
  currentProviderKeys,
  hasProviderKey,
  providerKey,
  providerKeySource,
  withProviderKeys,
} = await import("@/providers/keys");
const { getOpenAI, hasOpenAIKey } = await import("@/providers/openai/client");

describe("provider keys", () => {
  it("inside a maker's scope only its own keys count; outside, the environment's", () => {
    expect(providerKeySource("google")).toBe("env");
    withProviderKeys({ google: "g-saved" }, () => {
      expect(providerKey("google")).toBe("g-saved");
      expect(providerKeySource("google")).toBe("saved");
    });
    withProviderKeys({}, () => {
      expect(providerKey("google")).toBeUndefined();
      expect(providerKeySource("google")).toBeNull();
    });
    expect(providerKey("google")).toBe("g-env");
  });

  it("two makers working at once each see their own key", async () => {
    const seen: string[] = [];
    const work = (name: string, delay: number) =>
      withProviderKeys({ openai: `sk-${name}` }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        seen.push(`${name}:${providerKey("openai")}`);
      });
    await Promise.all([work("a", 20), work("b", 5)]);
    expect(seen.sort()).toEqual(["a:sk-a", "b:sk-b"]);
  });

  it("work started later from elsewhere keeps the keys it carried", async () => {
    const carried = withProviderKeys({ openai: "sk-carried" }, () =>
      currentProviderKeys(),
    );
    expect(providerKey("openai")).toBeUndefined();
    expect(withProviderKeys(carried, () => providerKey("openai"))).toBe(
      "sk-carried",
    );
  });

  it("no key anywhere is no key, and the client refuses before any request", () => {
    expect(hasProviderKey("openai")).toBe(false);
    expect(providerKeySource("openai")).toBeNull();
    expect(hasOpenAIKey()).toBe(false);
    expect(() => getOpenAI()).toThrow(/OpenAI has no API key/);
  });

  it("a different key builds a new client; the same key keeps its client", () => {
    withProviderKeys({ openai: "sk-one-1234567890" }, () => {
      const first = getOpenAI();
      expect(getOpenAI()).toBe(first);
      withProviderKeys({ openai: "sk-two-1234567890" }, () => {
        const second = getOpenAI();
        expect(second).not.toBe(first);
        expect(second.apiKey).toBe("sk-two-1234567890");
      });
    });
  });
});

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
const { ProviderKeyMissing } = await import("@/providers/errors");

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

  // A script or the CLI sets its key in the environment; the app never
  // reads it, so inside a maker's scope the message names no variable.
  it("outside a maker's scope a missing key names the environment variable", () => {
    expect(new ProviderKeyMissing("openai").message).toBe(
      "OpenAI has no API key: set OPENAI_API_KEY.",
    );
    expect(new ProviderKeyMissing("google").message).toBe(
      "Google has no API key: set GOOGLE_API_KEY.",
    );
  });

  it("inside a maker's scope a missing key never names the environment", () => {
    withProviderKeys({}, () => {
      const openai = new ProviderKeyMissing("openai");
      expect(openai.message).toBe(
        "OpenAI has no API key: add one in Settings → Providers.",
      );
      const google = new ProviderKeyMissing("google");
      expect(google.message).toBe(
        "Google has no API key: add one in Settings → Providers.",
      );
      for (const error of [openai, google]) {
        expect(error.message).not.toMatch(/API_KEY|\.env/);
      }
      expect(() => getOpenAI()).toThrow(
        "OpenAI has no API key: add one in Settings → Providers.",
      );
    });
  });

  it("a missing key keeps its name, its provider and its class in and out of a scope", () => {
    const outside = new ProviderKeyMissing("google");
    const inside = withProviderKeys({}, () => new ProviderKeyMissing("openai"));
    for (const error of [outside, inside]) {
      expect(error.name).toBe("ProviderKeyMissing");
      expect(error).toBeInstanceOf(ProviderKeyMissing);
      expect(error).toBeInstanceOf(Error);
    }
    expect(outside.provider).toBe("google");
    expect(inside.provider).toBe("openai");
  });

  // The app refuses a person in their own words under the same error, so
  // what reads its class or its name treats it as any missing key.
  it("a missing key given a message reads that message, in and out of a scope", () => {
    const words = "You have no access to an OpenAI key; ask Ana.";
    const outside = new ProviderKeyMissing("openai", words);
    const inside = withProviderKeys(
      {},
      () =>
        new ProviderKeyMissing(
          "google",
          "You have no access to a Google key; ask Ana.",
        ),
    );
    expect(outside.message).toBe(words);
    expect(inside.message).toBe("You have no access to a Google key; ask Ana.");
    for (const error of [outside, inside]) {
      expect(error.name).toBe("ProviderKeyMissing");
      expect(error).toBeInstanceOf(ProviderKeyMissing);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toMatch(/API_KEY|\.env|Settings/);
    }
    expect(outside.provider).toBe("openai");
    expect(inside.provider).toBe("google");
  });

  it("a missing key given no message keeps the one for where it runs", () => {
    expect(new ProviderKeyMissing("openai", undefined).message).toBe(
      "OpenAI has no API key: set OPENAI_API_KEY.",
    );
    expect(
      withProviderKeys({}, () => new ProviderKeyMissing("google", undefined))
        .message,
    ).toBe("Google has no API key: add one in Settings → Providers.");
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

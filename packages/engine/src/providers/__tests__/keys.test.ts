import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  KILN_PROVIDERS: "live" as const,
  OPENAI_API_KEY: undefined as string | undefined,
  GOOGLE_API_KEY: "g-env" as string | undefined,
}));
vi.mock("../../env", () => ({ env }));

const {
  currentProviderKeyIds,
  currentProviderKeys,
  hasProviderKey,
  providerKey,
  providerKeyId,
  withProviderKeys,
} = await import("@/providers/keys");
const { getOpenAI, hasOpenAIKey } = await import("@/providers/openai/client");
const { ProviderKeyMissing } = await import("@/providers/errors");

describe("provider keys", () => {
  it("inside a maker's scope only its own keys count; outside, the environment's", () => {
    expect(providerKey("google")).toBe("g-env");
    withProviderKeys({ google: "g-saved" }, () => {
      expect(providerKey("google")).toBe("g-saved");
    });
    withProviderKeys({}, () => {
      expect(providerKey("google")).toBeUndefined();
      expect(hasProviderKey("google")).toBe(false);
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

  // The scope also says which of the studio's keys is in use, so a call can
  // record the key it ran on; the id travels with the secret.
  describe("the key in use", () => {
    it("inside a scope with ids, each provider reads its own key's id", () => {
      withProviderKeys(
        { openai: "sk-bob", google: "g-team" },
        () => {
          expect(providerKeyId("openai")).toBe("key-bob");
          expect(providerKeyId("google")).toBe("key-team");
          expect(providerKey("openai")).toBe("sk-bob");
        },
        { openai: "key-bob", google: "key-team" },
      );
    });

    it("a scope given no ids has none, and keeps its keys as before", () => {
      withProviderKeys({ openai: "sk-saved" }, () => {
        expect(providerKeyId("openai")).toBeUndefined();
        expect(providerKeyId("google")).toBeUndefined();
        expect(currentProviderKeyIds()).toEqual({});
        expect(providerKey("openai")).toBe("sk-saved");
      });
    });

    it("work carried later from elsewhere keeps both the keys and their ids", async () => {
      const carried = withProviderKeys(
        { openai: "sk-bob" },
        () => ({ keys: currentProviderKeys(), ids: currentProviderKeyIds() }),
        { openai: "key-bob" },
      );
      expect(carried.ids).toEqual({ openai: "key-bob" });
      const later = await withProviderKeys(
        carried.keys,
        async () => {
          await new Promise((r) => setTimeout(r, 1));
          return [providerKey("openai"), providerKeyId("openai")];
        },
        carried.ids,
      );
      expect(later).toEqual(["sk-bob", "key-bob"]);
    });

    it("two pieces of work at once each read their own key's id", async () => {
      const seen: string[] = [];
      const work = (name: string, delay: number) =>
        withProviderKeys(
          { openai: `sk-${name}` },
          async () => {
            await new Promise((r) => setTimeout(r, delay));
            seen.push(`${name}:${providerKeyId("openai")}`);
          },
          { openai: `key-${name}` },
        );
      await Promise.all([work("a", 15), work("b", 2)]);
      expect(seen.sort()).toEqual(["a:key-a", "b:key-b"]);
    });

    it("outside any scope the environment's key is used and no key id is in use", () => {
      expect(providerKey("google")).toBe("g-env");
      expect(providerKeyId("google")).toBeUndefined();
      expect(providerKeyId("openai")).toBeUndefined();
      expect(currentProviderKeyIds()).toEqual({});
    });
  });
});

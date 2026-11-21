import { describe, expect, it } from "vitest";
import { providerBlock } from "@/lib/provider-block";

const note = (over = {}) => ({
  provider: "google" as const,
  keyPresent: true,
  lastError: null,
  ...over,
});

describe("providerBlock", () => {
  it("blocks a live call to a provider with no key, or one that rejected its key", () => {
    expect(providerBlock([note({ keyPresent: false })], "google", "live")).toBe(
      "Google has no API key: add one in Settings → Providers, or pick an OpenAI model.",
    );
    expect(
      providerBlock(
        [
          note({
            lastError: { message: "Google rejected the API key" },
            keyRejected: true,
          }),
        ],
        "google",
        "live",
      ),
    ).toContain("Google rejected the API key on its last call");
  });

  const rejected = note({
    provider: "openai" as const,
    lastError: { message: "OpenAI rejected the API key" },
    keyRejected: true,
  });
  const missing = note({ provider: "openai" as const, keyPresent: false });

  it("the owner, a token and a script read where to add or replace the key, as before", () => {
    const owner =
      "OpenAI has no API key: add one in Settings → Providers, or pick a Google model.";
    expect(providerBlock([missing], "openai", "live")).toBe(owner);
    expect(providerBlock([missing], "openai", "live", null)).toBe(owner);
    const replace =
      "OpenAI rejected the API key on its last call: replace it in Settings → Providers, or pick a Google model.";
    expect(providerBlock([rejected], "openai", "live")).toBe(replace);
    expect(providerBlock([rejected], "openai", "live", null)).toBe(replace);
    expect(
      providerBlock(
        [note({ lastError: { message: "x" }, keyRejected: true })],
        "google",
        "live",
        null,
      ),
    ).toBe(
      "Google rejected the API key on its last call: replace it in Settings → Providers, or pick an OpenAI model.",
    );
  });

  it("a member with no key in reach is told whom to ask, or to pick the other provider", () => {
    expect(providerBlock([missing], "openai", "live", "Ana")).toBe(
      "You have no access to an OpenAI key; ask Ana, or pick a Google model.",
    );
    expect(
      providerBlock([note({ keyPresent: false })], "google", "live", "Ana"),
    ).toBe(
      "You have no access to a Google key; ask Ana, or pick an OpenAI model.",
    );
  });

  it("a member reads a rejected key as the studio's, with whom to ask", () => {
    expect(providerBlock([rejected], "openai", "live", "Ana")).toBe(
      "OpenAI rejected the studio's key on its last call; ask Ana, or pick a Google model.",
    );
    expect(
      providerBlock(
        [note({ lastError: { message: "x" }, keyRejected: true })],
        "google",
        "live",
        "Ana",
      ),
    ).toBe(
      "Google rejected the studio's key on its last call; ask Ana, or pick an OpenAI model.",
    );
  });

  it("no member line sends them to Settings or tells them to replace a key", () => {
    for (const blocked of [missing, rejected]) {
      const line = providerBlock([blocked], "openai", "live", "Ana");
      expect(line).not.toMatch(/Settings|replace|add one|\.env|API_KEY|paste/i);
    }
  });

  it("a mock run and a healthy provider block no one, whoever reads", () => {
    expect(providerBlock([missing], "openai", "mock", "Ana")).toBeNull();
    expect(providerBlock([rejected], "openai", "mock", "Ana")).toBeNull();
    expect(providerBlock([note()], "google", "live", "Ana")).toBeNull();
  });

  it("lets a transient failure, a healthy provider and every mock run through", () => {
    expect(
      providerBlock(
        [note({ lastError: { message: "Google answered 503" } })],
        "google",
        "live",
      ),
    ).toBeNull();
    expect(providerBlock([note()], "google", "live")).toBeNull();
    expect(
      providerBlock([note({ keyPresent: false })], "google", "mock"),
    ).toBeNull();
    expect(providerBlock([], "openai", "live")).toBeNull();
  });
});

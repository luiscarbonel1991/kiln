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

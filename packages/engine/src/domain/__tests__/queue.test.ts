import { describe, expect, it } from "vitest";
import {
  classifyGenerationError,
  describeProviderError,
  hadResponse,
  retryDecision,
} from "@/domain/queue";

const withStatus = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

describe("classifyGenerationError", () => {
  it.each([400, 401, 403, 404, 422])("%i is permanent", (status) => {
    expect(classifyGenerationError(withStatus(status))).toBe("permanent");
  });

  it.each([408, 409, 429, 500, 502, 503])("%i is transient", (status) => {
    expect(classifyGenerationError(withStatus(status))).toBe("transient");
  });

  it("capability, validation and moderation errors are permanent", () => {
    const capability = Object.assign(new Error("no compose"), {
      name: "CapabilityError",
    });
    expect(classifyGenerationError(capability)).toBe("permanent");
    expect(classifyGenerationError({ issues: [] })).toBe("permanent");
    expect(
      classifyGenerationError(
        new Error("Your request was rejected by the safety system"),
      ),
    ).toBe("permanent");
  });

  it("timeouts, network, storage and unknown errors are transient", () => {
    expect(classifyGenerationError(new Error("fetch failed"))).toBe(
      "transient",
    );
    expect(classifyGenerationError(new Error("S3 PutObject failed"))).toBe(
      "transient",
    );
    expect(classifyGenerationError("weird")).toBe("transient");
  });
});

describe("retryDecision", () => {
  it("retries a transient failure once, then gives up", () => {
    expect(retryDecision(1, withStatus(503))).toEqual({
      retry: true,
      reason: "transient",
    });
    expect(retryDecision(2, withStatus(503))).toEqual({
      retry: false,
      reason: "exhausted",
    });
  });

  it("never retries a permanent failure", () => {
    expect(retryDecision(1, withStatus(400))).toEqual({
      retry: false,
      reason: "permanent",
    });
  });
});

describe("hadResponse", () => {
  it("an HTTP error is an answer; a timeout or a dropped connection is not", () => {
    expect(hadResponse(withStatus(503))).toBe(true);
    expect(hadResponse(withStatus(400))).toBe(true);
    expect(hadResponse(new Error("Request timed out."))).toBe(false);
    expect(
      hadResponse(Object.assign(new Error("aborted"), { name: "AbortError" })),
    ).toBe(false);
    expect(hadResponse(null)).toBe(false);
  });
});

describe("provider errors in plain words", () => {
  const spendCap = Object.assign(
    new Error(
      "Your project has exceeded its monthly spending cap. Manage it at https://ai.studio/spend",
    ),
    { status: 429 },
  );
  const quota = Object.assign(new Error("You exceeded your current quota"), {
    status: 429,
    code: "insufficient_quota",
  });

  it("Google's spend cap names the fix and OpenAI, and is never retried", () => {
    expect(describeProviderError("google", spendCap)).toBe(
      "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI.",
    );
    expect(classifyGenerationError(spendCap)).toBe("permanent");
  });

  it("OpenAI out of quota is never retried; a plain 429 is a rate limit, retried", () => {
    expect(describeProviderError("openai", quota)).toMatch(
      /^OpenAI is out of quota/,
    );
    expect(classifyGenerationError(quota)).toBe("permanent");
    expect(describeProviderError("google", withStatus(429))).toBe(
      "Google is rate-limiting requests — try again in a minute or use OpenAI.",
    );
    expect(classifyGenerationError(withStatus(429))).toBe("transient");
  });

  it("a rejected key names the variable; anything else keeps the provider's words", () => {
    expect(describeProviderError("openai", withStatus(401))).toBe(
      "OpenAI rejected the API key (401) — check OPENAI_API_KEY or use Google.",
    );
    expect(describeProviderError("google", new Error("socket hang up"))).toBe(
      "socket hang up",
    );
  });

  it("a missing key or a model Kiln does not offer is permanent", () => {
    for (const name of ["ProviderKeyMissing", "ModelRefused"]) {
      expect(
        classifyGenerationError(Object.assign(new Error("x"), { name })),
      ).toBe("permanent");
    }
  });
});

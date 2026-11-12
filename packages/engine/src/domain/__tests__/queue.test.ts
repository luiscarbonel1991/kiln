import { describe, expect, it } from "vitest";
import {
  classifyGenerationError,
  describeProviderError,
  hadResponse,
  providerWords,
  quotaOut,
  readableFailure,
  retryDecision,
} from "@/domain/queue";
import {
  ARGON_FREE_TIER,
  ARGON_PAID_NONE,
  FLASH_PER_DAY,
  FLASH_PER_MINUTE,
  fromChat,
  fromGoogleSdk,
} from "./fixtures/google-quota";

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

  // What Google's SDK put in the message for a bad key (10/22): the whole body.
  const googleBody = JSON.stringify({
    error: {
      code: 400,
      message: "API key not valid. Please pass a valid API key.",
      status: "INVALID_ARGUMENT",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "API_KEY_INVALID",
          domain: "googleapis.com",
        },
      ],
    },
  });

  it("Google's 400 for a bad key is a rejected key, not its JSON body", () => {
    expect(
      describeProviderError(
        "google",
        Object.assign(new Error(googleBody), { status: 400 }),
      ),
    ).toBe(
      "Google rejected the API key (400) — replace the key or use OpenAI.",
    );
    expect(readableFailure(googleBody, "google")).toBe(
      "Google rejected the API key — replace the key or use OpenAI.",
    );
  });

  it("any other JSON body says what the provider said, even cut short", () => {
    const body = (message: string) =>
      JSON.stringify({ error: { code: 400, message, status: "X" } });
    expect(
      describeProviderError(
        "google",
        Object.assign(
          new Error(`got status: 400. ${body('The "seed" field is unknown.')}`),
          { status: 400 },
        ),
      ),
    ).toBe('got status: 400. The "seed" field is unknown.');
    expect(readableFailure(body("Model is overloaded.").slice(0, 55))).toBe(
      "Model is overloaded.",
    );
    expect(providerWords("No JSON {here")).toBe("No JSON {here");
    expect(providerWords('{"error":{"code":500}}')).toBe(
      '{"error":{"code":500}}',
    );
  });

  it("a rejected key says to replace it; anything else keeps the provider's words", () => {
    expect(describeProviderError("openai", withStatus(401))).toBe(
      "OpenAI rejected the API key (401) — replace the key or use Google.",
    );
    expect(describeProviderError("google", new Error("socket hang up"))).toBe(
      "socket hang up",
    );
  });

  it("OpenAI out of quota read through the chat, its code gone, is still credit", () => {
    const chat = withStatus(429);
    chat.message =
      "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.";
    expect(quotaOut(chat)).toEqual({ kind: "credit" });
    expect(describeProviderError("openai", chat)).toMatch(
      /^OpenAI is out of quota/,
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

describe("Google's 429s", () => {
  it("a model the key's project has no quota for: not credit, not retried, in words", () => {
    for (const error of [
      fromGoogleSdk(ARGON_FREE_TIER),
      fromChat(ARGON_FREE_TIER),
    ]) {
      expect(quotaOut(error)).toEqual({
        kind: "model",
        model: "gemini-4-argon",
        why: "free-tier",
      });
      expect(classifyGenerationError(error)).toBe("permanent");
      expect(describeProviderError("google", error)).toBe(
        "Gemini 4 Argon is not on Google's free tier, and this key's project is on it — link a billing account to the project in AI Studio, or pick another model.",
      );
    }
    expect(describeProviderError("google", fromChat(ARGON_PAID_NONE))).toBe(
      "This key's Google project has no quota for Gemini 4 Argon — check its rate limits in AI Studio, or pick another model.",
    );
  });

  it("reads the message alone, with no body behind it", () => {
    const words = withStatus(429);
    words.message = ARGON_FREE_TIER.error.message;
    expect(quotaOut(words)).toMatchObject({ kind: "model", why: "free-tier" });
  });

  it("a day's quota used up waits for midnight, not 30 s", () => {
    const error = fromGoogleSdk(FLASH_PER_DAY);
    expect(quotaOut(error)).toEqual({
      kind: "model",
      model: "gemini-3.6-flash",
      why: "day",
    });
    expect(classifyGenerationError(error)).toBe("permanent");
    expect(describeProviderError("google", error)).toBe(
      "Gemini 3.6 Flash used up today's quota on this key's Google project — it resets at midnight Pacific time; pick another model meanwhile.",
    );
  });

  it("a per-minute limit is a rate limit, retried, though it says quota", () => {
    for (const error of [
      fromGoogleSdk(FLASH_PER_MINUTE),
      fromChat(FLASH_PER_MINUTE),
    ]) {
      expect(quotaOut(error)).toEqual({ kind: "rate" });
      expect(classifyGenerationError(error)).toBe("transient");
      expect(describeProviderError("google", error)).toBe(
        "Google is rate-limiting requests — try again in a minute or use OpenAI.",
      );
    }
  });

  it("only a 429 has run out of anything", () => {
    const body = JSON.stringify(ARGON_FREE_TIER);
    expect(
      quotaOut(Object.assign(new Error(body), { status: 400 })),
    ).toBeNull();
    expect(quotaOut(new Error(body))).toBeNull();
  });
});

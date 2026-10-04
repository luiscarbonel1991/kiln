import { describe, expect, it } from "vitest";
import { classifyGenerationError, retryDecision } from "@/domain/queue";

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

import { describe, expect, it } from "vitest";
import { gradientForPrompt, gradientForSeed, hashSeed } from "@/lib/gradient";

describe("gradient", () => {
  it("hashSeed is deterministic and non-negative", () => {
    expect(hashSeed("pitcher")).toBe(hashSeed("pitcher"));
    expect(hashSeed("pitcher")).toBeGreaterThanOrEqual(0);
  });

  it("gradientForSeed returns a stable css gradient string", () => {
    const gradient = gradientForSeed(5);
    expect(gradient).toBe(gradientForSeed(5));
    expect(gradient).toContain("radial-gradient");
    expect(gradient).toContain("linear-gradient");
  });

  it("gradientForPrompt is stable per prompt", () => {
    expect(gradientForPrompt("mug")).toBe(gradientForPrompt("mug"));
  });
});

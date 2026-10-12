import { describe, expect, it } from "vitest";
import { canUse, PROVIDER_CAPABILITIES } from "@/domain/capabilities";

describe("PROVIDER_CAPABILITIES", () => {
  it("google supports compose, openai does not", () => {
    expect(PROVIDER_CAPABILITIES.google.compose).toBe(true);
    expect(PROVIDER_CAPABILITIES.openai.compose).toBe(false);
  });

  it("both take three references beside the reference image", () => {
    expect(PROVIDER_CAPABILITIES.google.maxRefs).toBe(3);
    expect(PROVIDER_CAPABILITIES.openai.maxRefs).toBe(3);
  });
});

describe("canUse", () => {
  it("gates ops by support and refs by maxRefs", () => {
    expect(canUse(PROVIDER_CAPABILITIES.google, "edit", 3)).toBe(true);
    expect(canUse(PROVIDER_CAPABILITIES.google, "edit", 4)).toBe(false);
    expect(canUse(PROVIDER_CAPABILITIES.openai, "compose")).toBe(false);
    expect(canUse(PROVIDER_CAPABILITIES.openai, "edit", 3)).toBe(true);
    expect(canUse(PROVIDER_CAPABILITIES.openai, "edit", 4)).toBe(false);
  });
});

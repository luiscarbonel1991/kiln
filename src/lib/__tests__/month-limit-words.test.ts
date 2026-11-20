import { describe, expect, it } from "vitest";
import { memberOverLimit } from "@/lib/month-limit-words";

// The chat's approval card: a member's quote over the limit cannot be
// approved; the owner's (no "ask") still can, with its warning.
describe("memberOverLimit", () => {
  it("holds a member's quote that does not fit", () => {
    expect(memberOverLimit({ fitsCap: false, ask: "Ana" })).toBe(true);
  });

  it("lets a member's quote that fits, and any owner's quote, through", () => {
    expect(memberOverLimit({ fitsCap: true, ask: "Ana" })).toBe(false);
    expect(memberOverLimit({ fitsCap: false })).toBe(false);
    expect(memberOverLimit(null)).toBe(false);
  });
});

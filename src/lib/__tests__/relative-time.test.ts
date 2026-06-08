import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/relative-time";

const now = new Date("2026-06-02T12:00:00.000Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("formatRelativeTime", () => {
  it("says 'just now' under a minute", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("just now");
    expect(formatRelativeTime(ago(59), now)).toBe("just now");
  });

  it("counts whole minutes", () => {
    expect(formatRelativeTime(ago(60), now)).toBe("1m ago");
    expect(formatRelativeTime(ago(61), now)).toBe("1m ago");
    expect(formatRelativeTime(ago(59 * 60), now)).toBe("59m ago");
  });

  it("counts whole hours", () => {
    expect(formatRelativeTime(ago(60 * 60), now)).toBe("1h ago");
    expect(formatRelativeTime(ago(5 * 3600), now)).toBe("5h ago");
    expect(formatRelativeTime(ago(23 * 3600), now)).toBe("23h ago");
  });

  it("counts whole days", () => {
    expect(formatRelativeTime(ago(24 * 3600), now)).toBe("1d ago");
    expect(formatRelativeTime(ago(25 * 3600), now)).toBe("1d ago");
    expect(formatRelativeTime(ago(6 * 86400), now)).toBe("6d ago");
  });

  it("counts whole weeks", () => {
    expect(formatRelativeTime(ago(7 * 86400), now)).toBe("1w ago");
    expect(formatRelativeTime(ago(21 * 86400), now)).toBe("3w ago");
  });

  it("falls back to a date string past ~4 weeks", () => {
    const result = formatRelativeTime(ago(40 * 86400), now);
    expect(result).not.toMatch(/ago|just now/);
  });
});

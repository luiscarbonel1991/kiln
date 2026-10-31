import { describe, expect, it } from "vitest";
import {
  Effort,
  effortOn,
  googleThinking,
  textTimeoutMs,
  topEffort,
  turnMs,
} from "@/domain/effort";
import {
  TEXT_CALL_BUDGETS,
  type TextCallKind,
  textBudget,
} from "@/domain/generation-cost";
import { catalogFor } from "@/domain/model-defaults";

const sol = { provider: "openai", model: "gpt-6.1-sol" };
const flash = { provider: "google", model: "gemini-3.8-flash" };
const KINDS = Object.keys(TEXT_CALL_BUDGETS) as TextCallKind[];

describe("effort", () => {
  it("runs a level the model lacks at the highest it has below it", () => {
    for (const level of Effort.options) {
      expect(effortOn(sol, level)).toBe(level);
    }
    expect(effortOn(flash, "medium")).toBe("medium");
    expect(effortOn(flash, "xhigh")).toBe("high");
    expect(effortOn(flash, "max")).toBe("high");
    expect(topEffort(flash)).toBe("high");
    expect(topEffort(sol)).toBe("max");
  });

  it("sends Gemini a thinking level it takes", () => {
    expect(Effort.options.map(googleThinking)).toEqual([
      "low",
      "medium",
      "high",
      "high",
      "high",
    ]);
  });

  it("every text model offers low and says what it writes and reads", () => {
    for (const m of catalogFor("text")) {
      expect(m.efforts?.[0], m.id).toBe("low");
      expect(m.maxOutput, m.id).toBeGreaterThan(0);
      expect(m.sees, m.id).toBe(true);
    }
  });
});

describe("textBudget", () => {
  it("is the budget Kiln always sent at low, on every text model", () => {
    for (const m of catalogFor("text")) {
      for (const kind of KINDS) {
        expect(
          textBudget(kind, { provider: m.provider, model: m.id }, "low"),
        ).toEqual(TEXT_CALL_BUDGETS[kind]);
      }
    }
    expect(textBudget("chatTurn", sol)).toEqual(TEXT_CALL_BUDGETS.chatTurn);
  });

  it("grows the output with the level the model runs at", () => {
    expect(
      Effort.options.map((e) => textBudget("chatTurn", sol, e).outputTokens),
    ).toEqual([2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(textBudget("chatTurn", flash, "max").outputTokens).toBe(8_000);
    expect(textBudget("chatTurn", sol, "max").inputTokens).toBe(20_000);
  });

  it("never asks a model for more than it writes", () => {
    for (const m of catalogFor("text")) {
      for (const kind of KINDS) {
        for (const e of Effort.options) {
          expect(
            textBudget(kind, { provider: m.provider, model: m.id }, e)
              .outputTokens,
          ).toBeLessThanOrEqual(m.maxOutput ?? 0);
        }
      }
    }
  });
});

describe("time", () => {
  it("gives a minute a call and four a turn at low, more as it rises", () => {
    expect(textTimeoutMs("low")).toBe(60_000);
    expect(turnMs("low")).toBe(4 * 60_000);
    const turns = Effort.options.map(turnMs);
    expect([...turns].sort((a, b) => a - b)).toEqual(turns);
    expect(turnMs("max")).toBe(20 * 60_000);
  });
});

import { describe, expect, it } from "vitest";
import { estimateScenes, sceneLookEstimate } from "@/domain/generation-cost";
import { takeEstimate } from "@/domain/model-routing";
import {
  sceneLookFrom,
  TakeCheck,
  takeCheckLabel,
  uncheckedTake,
  withLook,
} from "@/domain/qc";

const passed: TakeCheck = {
  status: "passed",
  engine: "fake",
  lines: [{ expected: "The Kilns", found: true }],
  problems: [],
  notes: [],
  checkedAt: "2026-11-12T10:00:00.000Z",
};

describe("the look at a scene", () => {
  it("a model's answer becomes a look: flagged only with something to say", () => {
    expect(
      sceneLookFrom(
        {
          plausible: false,
          problems: [{ what: " No foot. ", where: "centre" }],
        },
        "gpt-6.1-sol",
      ),
    ).toEqual({
      status: "flagged",
      problems: [{ what: "No foot.", where: "centre" }],
      model: "gpt-6.1-sol",
    });
    expect(sceneLookFrom({ plausible: false, problems: [] }, "m").status).toBe(
      "clear",
    );
    expect(sceneLookFrom({ plausible: true, problems: [] }, "m").status).toBe(
      "clear",
    );
  });

  it("a flagged look fails the check and leads its label", () => {
    const flagged = withLook(passed, {
      status: "flagged",
      problems: [{ what: "The glass has no foot.", where: "centre" }],
      model: "gpt-6.1-sol",
    });
    expect(flagged.status).toBe("failed");
    expect(takeCheckLabel(flagged)).toBe(
      "check failed · looks off: The glass has no foot.",
    );
    expect(TakeCheck.parse(flagged).look?.status).toBe("flagged");
    // Put on again (a free recheck keeps the look), it is not said twice.
    const again = withLook(flagged, {
      status: "flagged",
      problems: [{ what: "The glass has no foot.", where: "centre" }],
    });
    expect(again.problems).toEqual(["looks off: The glass has no foot."]);
  });

  it("a clear look says it was looked over; an unseen one changes nothing", () => {
    const clear = withLook(passed, { status: "clear", problems: [] });
    expect(clear.status).toBe("passed");
    expect(takeCheckLabel(clear)).toBe("checked · text 1/1 · looked over");
    const unseen = withLook(passed, {
      status: "unseen",
      problems: [],
      why: "OpenAI is down",
    });
    expect(takeCheckLabel(unseen)).toBe("checked · text 1/1");
    const unread = withLook(
      uncheckedTake("nothing to read", "2026-11-12T10:00:00.000Z"),
      { status: "clear", problems: [] },
    );
    expect(takeCheckLabel(unread)).toBe(
      "unchecked · nothing to read · looked over",
    );
  });

  it("a check stored before the look still reads", () => {
    expect(TakeCheck.parse(passed).look).toBeUndefined();
  });
});

describe("what the look costs", () => {
  it("is priced from the model's pinned price: typical as measured, max its allowance", () => {
    // GPT-6.1 Sol: $2 in, $10 out per million tokens.
    expect(
      sceneLookEstimate({ provider: "openai", model: "gpt-6.1-sol" }),
    ).toEqual({ typical: 0.006, max: 0.021 });
    expect(
      sceneLookEstimate({ provider: "openai", model: "gpt-image-2" }),
    ).toBeNull();
    expect(sceneLookEstimate({ provider: "openai", model: "nope" })).toBeNull();
  });

  it("joins a take's price and a plan's, per scene", () => {
    const model = { provider: "openai" as const, model: "gpt-image-2" };
    const look = { typical: 0.006, max: 0.021 };
    const bare = takeEstimate(model, 0, null);
    const looked = takeEstimate(model, 0, null, look);
    expect(bare).not.toBeNull();
    expect(looked?.typical).toBeCloseTo((bare?.typical ?? 0) + 0.006, 4);
    expect(looked?.max).toBeCloseTo((bare?.max ?? 0) + 0.021, 4);
    const slots = [{ aspect: "1:1" }, { aspect: "1:1" }];
    const plan = estimateScenes(slots, model);
    const planLooked = estimateScenes(slots, model, 0, look);
    expect(planLooked?.typical).toBeCloseTo((plan?.typical ?? 0) + 0.012, 2);
  });
});

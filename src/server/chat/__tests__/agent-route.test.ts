import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import { type MakerRoutes, proposeRoutes } from "@/domain/model-routing";

// A model that reads no images, for the rule that guards the agents that
// look: every catalog text model reads them today.
vi.mock("@/domain/model-routing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/domain/model-routing")>();
  return {
    ...real,
    routeSees: (route: { models: { model: string }[] }) =>
      route.models.every((m) => m.model !== "gpt-6-luna"),
  };
});

const { agentLooks, agentRouteIn, agentRoutesProblem } = await import(
  "@/server/chat/agent-route"
);
const { SPECIALISTS } = await import("@/server/chat/specialists");

const ASTRA = { provider: "openai" as const, model: "gpt-6-astra" };
const ARGON = { provider: "google" as const, model: "gemini-4-argon" };
const routes: MakerRoutes = {
  ...proposeRoutes(DEFAULT_MAKER_MODELS, { openai: true, google: true }),
};
const setup = {
  models: DEFAULT_MAKER_MODELS,
  routes: { ...routes, deep: { ...routes.deep, effort: "high" as const } },
  agents: {
    etsy: { models: [ASTRA, ARGON], fallback: true, effort: "max" as const },
  },
};

describe("an agent's route", () => {
  it("runs an agent on its own route at its effort, turns and plans alike", () => {
    for (const kind of ["chatTurn", "chatPlan"] as const) {
      expect(agentRouteIn(setup, "etsy", kind)).toEqual({
        candidates: [ASTRA, ARGON],
        effort: "max",
        own: true,
      });
    }
  });

  it("runs the others on the fast route, or deep when planning first", () => {
    expect(agentRouteIn(setup, "scenes", "chatTurn")).toMatchObject({
      candidates: routes.fast.models,
      effort: "low",
      own: false,
    });
    expect(agentRouteIn(setup, "scenes", "chatPlan")).toMatchObject({
      candidates: routes.deep.models,
      effort: "high",
      own: false,
    });
  });

  it("knows which agents look at images, from their tools", () => {
    expect(agentLooks(SPECIALISTS.kiln)).toBe(true);
    expect(agentLooks(SPECIALISTS.scenes)).toBe(true);
    expect(agentLooks(SPECIALISTS.svg)).toBe(true);
    expect(agentLooks(SPECIALISTS.etsy)).toBe(false);
  });

  it("refuses a model that reads no images for an agent that looks, and an agent Kiln lacks", () => {
    const luna = { provider: "openai" as const, model: "gpt-6-luna" };
    expect(
      agentRoutesProblem({ etsy: { models: [luna], fallback: false } }),
    ).toBeNull();
    expect(
      agentRoutesProblem({ scenes: { models: [ASTRA, luna], fallback: true } }),
    ).toBe("Scenes looks at images: GPT-6 Luna does not read them.");
    expect(
      agentRoutesProblem({ helper: { models: [ASTRA], fallback: false } }),
    ).toBe('Kiln has no agent "helper".');
  });
});

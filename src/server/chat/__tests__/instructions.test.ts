import { describe, expect, it, vi } from "vitest";

// What the agent is told: the rules, its mode's know-how, and the
// conversation's project in a line — a project's frames, or a design's
// drawings.

vi.mock("@/server/project-frames", () => ({
  projectFrames: async (id: string) =>
    id === "p1"
      ? {
          project: {
            id,
            name: "Planter",
            type: "listing-kit",
            phase: "generation",
          },
          frames: [{ state: "to-review" }, { state: "approved" }],
        }
      : null,
}));
vi.mock("@/server/designs", () => ({
  designView: async (id: string) =>
    id === "d1"
      ? {
          project: { id, name: "Fern", updatedAt: "" },
          master: null,
          subject: null,
          drawings: [
            { state: "drawn" },
            { state: "to-draw" },
            { state: "to-draw" },
          ],
        }
      : null,
}));

const { chatInstructions } = await import("@/server/chat/instructions");
const { SPECIALISTS } = await import("@/server/chat/specialists");
const NOW = new Date("2026-10-30T12:00:00Z");

describe("chatInstructions", () => {
  it("names a project's frames, a design's drawings, or the maker's own conversation", async () => {
    const project = await chatInstructions("p1", SPECIALISTS.kiln, NOW);
    expect(project).toContain('the project "Planter" (Project id: p1;');
    expect(project).toContain("1 to-review, 1 approved");
    const design = await chatInstructions("d1", SPECIALISTS.svg, NOW);
    expect(design).toContain(
      'the design "Fern" (Project id: d1; a design, with no frames). Its 3 drawings: 1 drawn, 2 to-draw. get_design reads them.',
    );
    expect(design).toContain("You are Kiln's SVG specialist");
    const maker = await chatInstructions(null, SPECIALISTS.kiln, NOW);
    expect(maker).toContain("on no project");
    expect(maker).toContain("Today is 2026-10-30.");
  });

  it("names every paid tool in the rule for paid work", async () => {
    const { NEEDS_CLICK } = await import("@/server/chat/chat-tools");
    const text = await chatInstructions(null, SPECIALISTS.kiln, NOW);
    for (const tool of NEEDS_CLICK.filter(
      (t) => t !== "approve_frame" && t !== "deliver",
    )) {
      expect(text).toContain(tool);
    }
  });
});

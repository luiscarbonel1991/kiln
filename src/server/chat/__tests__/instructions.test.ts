import { describe, expect, it, vi } from "vitest";

// What the agent is told: the rules, its mode's know-how, the
// conversation's project in a line — a project's frames, or a design's
// drawings — and the maker's kept lessons for its family and mode.

const asked: unknown[][] = [];
vi.mock("@/server/lessons", () => ({
  keptLessons: async (family: string | null, topics: string[] | null) => {
    asked.push([family, topics]);
    return family === "Kitchen"
      ? [{ text: "Kitchen, Etsy's Hero: the camera a little above." }]
      : [];
  },
}));
vi.mock("@/server/project-repository", () => ({
  loadProjectBoard: async (id: string) =>
    id === "p1" ? { product: { family: "Kitchen" } } : null,
}));

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
  it("offers to import a product Kiln does not have, never another in its place", async () => {
    const own = await chatInstructions(null, SPECIALISTS.kiln, NOW);
    expect(own).toContain(
      "A product the maker names that list_products does not have: say so and never stand another product in for it.",
    );
    expect(own).toContain("you import it with import_products");
  });

  it("names a project's frames, a design's drawings, or the maker's own conversation", async () => {
    const project = await chatInstructions("p1", SPECIALISTS.kiln, NOW);
    expect(project).toContain('the project "Planter" (Project id: p1;');
    expect(project).toContain("a Kitchen product");
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

  it("tells the maker's kept lessons for the project's family, on the mode's topics", async () => {
    asked.length = 0;
    const scenes = await chatInstructions("p1", SPECIALISTS.scenes, NOW);
    expect(scenes).toContain(
      "The maker's kept lessons (for Kitchen and every family):\n- Kitchen, Etsy's Hero: the camera a little above.",
    );
    await chatInstructions("d1", SPECIALISTS.svg, NOW);
    expect(asked).toEqual([
      ["Kitchen", ["scenes", "general"]],
      [null, ["designs", "general"]],
    ]);
    expect(await chatInstructions(null, SPECIALISTS.kiln, NOW)).not.toContain(
      "The maker's kept lessons:",
    );
  });

  it("answers in the language of the maker's message, and keeps the lessons in one", async () => {
    // A lesson kept in another language than the maker's message set the
    // answer's language on the eval's fast model: lessons are proposed in
    // English, as Kiln writes its own.
    const text = await chatInstructions(null, SPECIALISTS.kiln, NOW);
    expect(text).toContain("in the language of the maker's latest message");
    expect(text).toContain("propose_lesson it in one English sentence");
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

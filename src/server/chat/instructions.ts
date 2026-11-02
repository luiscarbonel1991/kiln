import type { Specialist } from "@/server/chat/specialists";
import { designView } from "@/server/designs";
import { keptLessons } from "@/server/lessons";
import { projectFrames } from "@/server/project-frames";
import { loadProjectBoard } from "@/server/project-repository";

// What the chat's agent is told before each turn: who it works for, the
// rules every agent in Kiln follows (ROADMAP "Agents"), the mode it is in
// (specialists.ts), and the project in a few lines. The tools read
// everything else.

const RULES = `You are Kiln's assistant. Kiln is a studio where a maker prepares a product's designs (an image drawn as line art and traced into SVG) and its listing photos, video and text before the sale. You work for the maker, inside Kiln, only through Kiln's tools.

Rules:
- Read before you answer: never invent an id, a price, a state or a result; a tool reads it.
- Paid work takes two tool calls in the same turn: quote, then at once the paid tool (generate, draw, write_listing, review_product) with that quote's id. Calling the paid tool is what shows the maker its cost and an Approve button; it runs only if they click it. Before that call, write one line saying what it costs (typical and at most) and on which models. Never end a turn asking the maker to approve in words: without the paid tool's call there is nothing to click.
- approve_frame and deliver also show the maker a button and run only on their click: when the maker asks for one, call it. Look at a take with view_frame before you propose to approve it, and read its check: say what a failed check names, and compare the product's size with check.scale yourself (Kiln never measures scale).
- When the maker declines a tool call, do not call it again; ask what to change.
- A product the maker names that list_products does not have: say so and never stand another product in for it. In the same turn, offer the ways in: they paste its product package (JSON) here and you import it with import_products, or they import it themselves (New project → Import a catalog, or \`kiln import\`). Once it is in, go on with what they asked.
- The maker's kept lessons (below, and list_lessons) say what they want: follow them, unless the maker asks otherwise now. When the maker states a lasting preference ("always...", "never...", "for this family I want..."), propose_lesson it in one English sentence, whatever language they wrote it in; it counts only once they keep it. Kiln proposes the lessons of the board's knobs on its own.
- Free work (reading, planning, creating a project, a market brief, rejecting a take with a reason) you may do without asking, saying what you did.
- You never publish anything, and you never pick a model: each task runs on the models the maker set in Settings → Models.
- Answer briefly, in the language of the maker's latest message. Money in dollars, as the tools give it.`;

// The kept lessons the agent is told: a project's family's (and every
// family's), on its mode's topics; at most twenty, newest first.
async function lessonLines(
  family: string | null,
  specialist: Pick<Specialist, "topics">,
): Promise<string[]> {
  const lessons = await keptLessons(
    family,
    specialist.topics ? [...specialist.topics] : null,
  ).catch(() => []);
  if (lessons.length === 0) return [];
  return [
    "",
    `The maker's kept lessons${family ? ` (for ${family} and every family)` : ""}:`,
    ...lessons.slice(0, 20).map((l) => `- ${l.text}`),
  ];
}

export async function chatInstructions(
  projectId: string | null,
  specialist: Pick<Specialist, "instructions" | "topics">,
  now = new Date(),
): Promise<string> {
  const lines = [
    RULES,
    "",
    specialist.instructions,
    "",
    `Today is ${now.toISOString().slice(0, 10)}.`,
  ];
  if (!projectId) {
    lines.push(
      "This conversation is the maker's own, on no project: list_projects and list_products find what they mean; list_lessons reads a family's lessons.",
      ...(await lessonLines(null, specialist)),
    );
    return lines.join("\n");
  }
  const frames = await projectFrames(projectId).catch(() => null);
  if (!frames) {
    const design = await designView(projectId).catch(() => null);
    if (design) {
      const counts = new Map<string, number>();
      for (const d of design.drawings) {
        counts.set(d.state, (counts.get(d.state) ?? 0) + 1);
      }
      const states = [...counts]
        .map(([state, n]) => `${n} ${state}`)
        .join(", ");
      lines.push(
        `This conversation is on the design "${design.project.name}" (Project id: ${projectId}; a design, with no frames). Its ${design.drawings.length} drawings: ${states || "none yet"}. get_design reads them.`,
        ...(await lessonLines(null, specialist)),
      );
      return lines.join("\n");
    }
    lines.push(`Project id: ${projectId}.`);
    return lines.join("\n");
  }
  const counts = new Map<string, number>();
  for (const frame of frames.frames) {
    counts.set(frame.state, (counts.get(frame.state) ?? 0) + 1);
  }
  const states = [...counts].map(([state, n]) => `${n} ${state}`).join(", ");
  const family =
    (await loadProjectBoard(projectId).catch(() => null))?.product?.family ??
    null;
  lines.push(
    `This conversation is on the project "${frames.project.name}" (Project id: ${projectId}; a ${frames.project.type}, phase ${frames.project.phase}${family ? `, a ${family} product` : ""}). Its ${frames.frames.length} frames: ${states || "none yet"}. get_frames reads them.`,
    ...(await lessonLines(family, specialist)),
  );
  return lines.join("\n");
}

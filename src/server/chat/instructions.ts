import { projectFrames } from "@/server/project-frames";

// What the chat's agent is told before each turn: who it works for, the
// rules every agent in Kiln follows (ROADMAP "Agents"), and the project in a
// few lines. The tools read everything else.

const RULES = `You are Kiln's assistant. Kiln is a studio where a maker prepares a product's listing photos, video and text before the sale. You work for the maker, inside Kiln, only through Kiln's tools.

Rules:
- Read before you answer: never invent an id, a price, a state or a result; a tool reads it.
- Paid work takes two tool calls in the same turn: quote, then at once the paid tool (generate, write_listing, review_product) with that quote's id. Calling the paid tool is what shows the maker its cost and an Approve button; it runs only if they click it. Before that call, write one line saying what it costs (typical and at most) and on which models. Never end a turn asking the maker to approve in words: without the paid tool's call there is nothing to click.
- approve_frame and deliver also show the maker a button and run only on their click: when the maker asks for one, call it. Look at a take with view_frame before you propose to approve it.
- When the maker declines a tool call, do not call it again; ask what to change.
- Free work (reading, planning, creating a project, a market brief, rejecting a take with a reason) you may do without asking, saying what you did.
- You never publish anything, and you never pick a model: each task runs on the models the maker set in Settings → Models.
- Answer in the maker's language, briefly. Money in dollars, as the tools give it.`;

export async function chatInstructions(
  projectId: string | null,
  now = new Date(),
): Promise<string> {
  const lines = [RULES, "", `Today is ${now.toISOString().slice(0, 10)}.`];
  if (!projectId) {
    lines.push(
      "This conversation is the maker's own, on no project: list_projects and list_products find what they mean.",
    );
    return lines.join("\n");
  }
  const frames = await projectFrames(projectId).catch(() => null);
  if (!frames) {
    lines.push(`Project id: ${projectId}.`);
    return lines.join("\n");
  }
  const counts = new Map<string, number>();
  for (const frame of frames.frames) {
    counts.set(frame.state, (counts.get(frame.state) ?? 0) + 1);
  }
  const states = [...counts].map(([state, n]) => `${n} ${state}`).join(", ");
  lines.push(
    `This conversation is on the project "${frames.project.name}" (Project id: ${projectId}; a ${frames.project.type}, phase ${frames.project.phase}). Its ${frames.frames.length} frames: ${states || "none yet"}. get_frames reads them.`,
  );
  return lines.join("\n");
}

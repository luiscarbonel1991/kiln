import { z } from "zod";
import { runTurn, TurnRefusal } from "@/server/chat/run-turn";
import { apiError, foreignOrigin, readBody } from "@/server/http-api";

// POST /api/chat — one turn of Kiln's chat (ROADMAP "Agents", stage 2): the
// conversation, and what the maker did (a message, or a yes or no to a tool
// call that waits). It answers the agent's reply as the AI SDK's UI message
// stream. Kiln's own pages only; the conversation itself is read from the
// database, never from the request.
const MAX_BODY_BYTES = 256 * 1024;

const Body = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.unknown(),
  plan: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (foreignOrigin(request)) {
    return apiError(403, "Kiln's chat answers only Kiln's own pages.");
  }
  const body = await readBody(request, MAX_BODY_BYTES);
  if (!body) return apiError(413, "That message is too long.");
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(Buffer.from(body).toString("utf8")));
  } catch {
    return apiError(400, "Send a conversation and a message.");
  }
  try {
    return await runTurn(parsed);
  } catch (error) {
    if (error instanceof TurnRefusal)
      return apiError(error.status, error.message);
    throw error;
  }
}

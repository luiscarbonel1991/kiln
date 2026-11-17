import { getChat } from "@/server/chat/chat-repository";
import { stopTurn } from "@/server/chat/run-turn";
import { sessionRoute } from "@/server/guarded";
import { apiError, foreignOrigin } from "@/server/http-api";

// POST /api/chat/:id/stop — end the turn running in a conversation. What it
// did stays; a model call stopped midway counts at its estimate.
export const POST = sessionRoute(
  async (
    _maker,
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    if (foreignOrigin(request)) {
      return apiError(403, "Kiln's chat answers only Kiln's own pages.");
    }
    const { id } = await params;
    if (!(await getChat(id))) {
      return apiError(404, "No conversation of yours has that id.");
    }
    return Response.json({ stopped: stopTurn(id) });
  },
);

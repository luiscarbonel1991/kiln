import { getChat } from "@/server/chat/chat-repository";
import { sessionRoute } from "@/server/guarded";
import { apiError } from "@/server/http-api";

// GET /api/chat/:id — a conversation as stored, and whether a turn is
// running in it: what the chat reads after a reload, until the turn ends.
export const GET = sessionRoute(
  async (
    _maker,
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const chat = await getChat(id);
    if (!chat) return apiError(404, "No conversation of yours has that id.");
    return Response.json(chat, { headers: { "Cache-Control": "no-store" } });
  },
);

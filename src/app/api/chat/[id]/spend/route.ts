import { chatRuns } from "@/server/chat/chat-view";
import { sessionRoute } from "@/server/guarded";
import { apiError } from "@/server/http-api";

// GET /api/chat/:id/spend — what the conversation's paid tools spent and
// what their queued work holds (`runs` null in a mock run): what the chat
// reads while that work runs.
export const GET = sessionRoute(
  async (
    maker,
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const found = await chatRuns(maker, id);
    if (!found) return apiError(404, "No conversation of yours has that id.");
    return Response.json(found, { headers: { "Cache-Control": "no-store" } });
  },
);

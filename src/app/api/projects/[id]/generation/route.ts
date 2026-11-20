import { projectGenerationState } from "@/server/generation-repository";
import { sessionRoute } from "@/server/guarded";

// What the board and the slot editor poll while generations run: each card's
// latest job and output, the batch's progress and a version; no amount of
// this month's, so a member's poll carries none. A GET Route Handler (not a
// Server Action) on purpose: Server Actions from one client run one at a
// time, so polling through them would make an Approve click wait. Not cached
// (Route Handlers are dynamic).
export const GET = sessionRoute(
  async (
    maker,
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    return Response.json(await projectGenerationState(maker.id, id), {
      headers: { "Cache-Control": "no-store" },
    });
  },
);

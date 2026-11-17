import { projectGenerationState } from "@/server/generation-repository";
import { getCurrentMaker } from "@/server/maker-repository";
import { denyWithoutSession } from "@/server/session";

// What the board and the slot editor poll while generations run: each card's
// latest job and output, the batch's progress, the month's budget and a
// version. A GET Route Handler (not a Server Action) on purpose: Server
// Actions from one client run one at a time, so polling through them would
// make an Approve click wait. Not cached (Route Handlers are dynamic).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await denyWithoutSession();
  if (denied) return denied;
  const { id } = await params;
  const maker = await getCurrentMaker();
  return Response.json(await projectGenerationState(maker.id, id), {
    headers: { "Cache-Control": "no-store" },
  });
}

import { tokenRoute } from "@/server/guarded";
import { apiError, apiJson } from "@/server/http-api";
import { projectFrames } from "@/server/project-frames";

type Context = { params: Promise<{ id: string }> };

// GET /api/projects/:id/frames — each frame as the board shows it: { project,
// frames: [{ frame, destinationId, slotKey, label, fill, aspect, state,
// failed, error?, output, approvedOutput, approvable, versionOf? }] }.
// `output` is the take an approval approves. 404 for a project of another
// maker, or one with no frames (a studio project).
export const GET = tokenRoute(
  async (_caller, _request: Request, { params }: Context) => {
    const { id } = await params;
    const frames = await projectFrames(id);
    if (!frames)
      return apiError(404, "No project of yours with frames has that id.");
    return apiJson(frames);
  },
);

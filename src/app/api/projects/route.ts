import { tokenRoute } from "@/server/guarded";
import { apiJson } from "@/server/http-api";
import { framedProjects } from "@/server/project-frames";

// GET /api/projects — the projects that have frames (started from New
// project), newest first: { projects: [{ id, name, type, phase, updatedAt }] }.
export const GET = tokenRoute(async (_caller, _request: Request) => {
  return apiJson({ projects: await framedProjects() });
});

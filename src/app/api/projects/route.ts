import { apiJson, authorize } from "@/server/http-api";
import { framedProjects } from "@/server/project-frames";

// GET /api/projects — the projects that have frames (started from New
// project), newest first: { projects: [{ id, name, type, phase, updatedAt }] }.
export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  return apiJson({ projects: await framedProjects() });
}

import { MAX_UPLOAD_BYTES } from "@/components/studio/constants";
import { tokenRoute } from "@/server/guarded";
import { apiError, apiJson, megabytes, readBody } from "@/server/http-api";
import { addProjectReference } from "@/server/project-reference";

type Context = { params: Promise<{ id: string }> };

// POST /api/projects/:id/reference — the product's photo (PNG, JPEG or WebP,
// at most 15 MB) as the raw body: the project's reference image, as the
// board's "Add reference image" sets it. For a product Kiln cannot draw for
// free (no design file), this is what lets its scenes be quoted. 400 for an
// empty body or a project with no plan, 404 for an unknown project, 413 over
// the cap, 415 for anything but a PNG, JPEG or WebP.
export const POST = tokenRoute(
  async (_caller, request: Request, { params }: Context) => {
    const { id } = await params;
    const body = await readBody(request, MAX_UPLOAD_BYTES);
    if (!body) {
      return apiError(
        413,
        `A reference image is at most ${megabytes(MAX_UPLOAD_BYTES)}.`,
      );
    }
    const outcome = await addProjectReference(id, body);
    if (!outcome.ok) return apiError(outcome.status, outcome.error);
    const { ok: _ok, ...result } = outcome;
    return apiJson(result);
  },
);

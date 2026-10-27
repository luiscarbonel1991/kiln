import { ReadKey } from "@/domain/listing-results";
import { apiError, apiJson, authorize, readBody } from "@/server/http-api";
import { ReadInput, ResultsRefusal, saveRead } from "@/server/listing-results";

type Context = {
  params: Promise<{ id: string; destinationId: string; read: string }>;
};

const MAX_READ_BYTES = 16 * 1024;

// PUT /api/projects/:id/results/:destinationId/:read — one read of a
// delivered listing's numbers (`:read` is before, day14 or day30), as JSON:
// { visits, views, favourites, orders, revenue, searchVisits } (any of them),
// and optionally { from, to } (its window; default the read's own), `source`
// (default "API") and `readOn` (default today). It replaces a read taken
// before. 200 with the read kept; 400 for a body that is not JSON; 404 for an
// unknown project, destination or read; 422 for a read Kiln cannot keep (a
// number that is not a whole count, a destination not delivered yet).
export async function PUT(request: Request, { params }: Context) {
  const denied = await authorize(request);
  if (denied) return denied;
  const { id, destinationId, read } = await params;
  const key = ReadKey.safeParse(read);
  if (!key.success) {
    return apiError(404, `"${read}" is not a read: before, day14 or day30.`);
  }
  const body = await readBody(request, MAX_READ_BYTES);
  if (!body) return apiError(413, "A read is a few numbers: send less.");
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return apiError(400, "The body is not JSON: send the read's numbers.");
  }
  const input = ReadInput.safeParse(json);
  if (!input.success) {
    return apiError(422, "Dates are YYYY-MM-DD and the source is text.");
  }
  try {
    const saved = await saveRead({
      projectId: id,
      destinationId,
      key: key.data,
      read: input.data,
      source: "API",
    });
    return apiJson({ read: saved });
  } catch (error) {
    if (error instanceof Error && error.message === "project not found") {
      return apiError(404, "No project of yours has that id.");
    }
    if (error instanceof ResultsRefusal) {
      return apiError(
        /not a (sale )?destination/.test(error.message) ? 404 : 422,
        error.message,
      );
    }
    throw error;
  }
}

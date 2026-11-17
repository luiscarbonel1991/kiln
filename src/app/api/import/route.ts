import { tokenRoute } from "@/server/guarded";
import { apiError, apiJson, megabytes, readBody } from "@/server/http-api";
import { importPackage, importSummary } from "@/server/product-import";

// POST /api/import — a product package (JSON) for the maker the token acts
// for: the same import as New project's "Import a catalog", product by
// product. 200 with what was imported, updated, unchanged and set aside (a
// package with products set aside is still a 200: read `rejected`); 400 when
// the body is not JSON, 413 over the size cap, 422 when nothing in it reads
// as a package or the save failed (nothing saved). Inline (data:) images are
// stored; any other asset address must be in the allowlist (URL import stays
// out: the caller sends the bytes).
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;

export const POST = tokenRoute(async (_caller, request: Request) => {
  const body = await readBody(request, MAX_PACKAGE_BYTES);
  if (!body) {
    return apiError(
      413,
      `A package is at most ${megabytes(MAX_PACKAGE_BYTES)}. Send large images as material photos one by one, or split the catalog.`,
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return apiError(
      400,
      "The body is not JSON: send the product package itself, as application/json.",
    );
  }
  const result = await importPackage(input);
  if ("error" in result) return apiError(422, result.error);
  return apiJson(importSummary(result));
});

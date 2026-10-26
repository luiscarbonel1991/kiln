import { MAX_UPLOAD_BYTES } from "@/components/studio/constants";
import {
  apiError,
  apiJson,
  authorize,
  megabytes,
  readBody,
} from "@/server/http-api";
import { setColourSwatch } from "@/server/product-swatch";

type Context = { params: Promise<{ id: string; key: string }> };

// A multipart form carries the photo plus its boundaries and headers: the
// body may pass the photo's cap by this much, and the photo itself is held to
// the cap once read.
const FORM_ENVELOPE_BYTES = 1024 * 1024;

const isForm = (request: Request) =>
  (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");

// A photo from a multipart form's `file` field, or the body itself.
async function photoOf(
  request: Request,
  body: Uint8Array,
): Promise<Uint8Array | null> {
  if (!isForm(request)) return body;
  const type = request.headers.get("content-type") ?? "";
  try {
    const form = await new Response(Buffer.from(body), {
      headers: { "content-type": type },
    }).formData();
    const file = form.get("file");
    return file instanceof File
      ? new Uint8Array(await file.arrayBuffer())
      : null;
  } catch {
    return null;
  }
}

// POST /api/products/:id/colours/:key/swatch — a colour's material photo
// (PNG, JPEG or WebP, at most 15 MB), as the raw body (any image
// Content-Type) or a multipart form's `file`. `:id` is the product's Kiln id
// or its sku. The swatch hex stays; the photo's own colour comes back as
// `photoColour`, a suggestion. 404 for an unknown product or colour, 409 for
// a product from a catalog connector, 413 over the cap, 415 for anything but
// a PNG, JPEG or WebP.
export async function POST(request: Request, { params }: Context) {
  const denied = await authorize(request);
  if (denied) return denied;
  const { id, key } = await params;
  const tooLarge = () =>
    apiError(
      413,
      `A material photo is at most ${megabytes(MAX_UPLOAD_BYTES)}.`,
    );
  const body = await readBody(
    request,
    MAX_UPLOAD_BYTES + (isForm(request) ? FORM_ENVELOPE_BYTES : 0),
  );
  if (!body) return tooLarge();
  const photo = await photoOf(request, body);
  if (photo && photo.length > MAX_UPLOAD_BYTES) return tooLarge();
  if (!photo || photo.length === 0) {
    return apiError(
      400,
      "Send the photo as the body (Content-Type: image/jpeg, image/png or image/webp) or as a multipart form's file field.",
    );
  }
  const outcome = await setColourSwatch(id, key, photo);
  if (!outcome.ok) return apiError(outcome.status, outcome.error);
  const { ok: _ok, ...result } = outcome;
  return apiJson(result);
}

// DELETE — the colour's material photo removed; its scenes go back to the
// plate and the swatch hex alone.
export async function DELETE(request: Request, { params }: Context) {
  const denied = await authorize(request);
  if (denied) return denied;
  const { id, key } = await params;
  const outcome = await setColourSwatch(id, key, null);
  if (!outcome.ok) return apiError(outcome.status, outcome.error);
  const { ok: _ok, ...result } = outcome;
  return apiJson(result);
}

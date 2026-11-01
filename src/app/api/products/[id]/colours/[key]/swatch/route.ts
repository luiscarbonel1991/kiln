import { MAX_UPLOAD_BYTES } from "@/components/studio/constants";
import {
  apiError,
  apiJson,
  authorize,
  megabytes,
  readBody,
} from "@/server/http-api";
import { type SwatchFix, setColourSwatch } from "@/server/product-swatch";

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

const WHITE_HINT =
  "white is the spot to make neutral, from the photo's top left: x,y, each from 0 to 1 (white=0.42,0.61).";

// The correction asked in the query: `white=x,y` balances the light from that
// spot, `match=swatch` brings the photo's colour to the swatch.
function fixOf(url: URL): SwatchFix | { error: string } | null {
  const white = url.searchParams.get("white");
  const match = url.searchParams.get("match");
  if (white !== null && match !== null) {
    return { error: "Send white or match=swatch, not both." };
  }
  if (match !== null) {
    return match === "swatch"
      ? { match: "swatch" }
      : { error: "match takes one value: match=swatch." };
  }
  if (white === null) return null;
  const [x, y, ...more] = white.split(",").map((v) => Number(v.trim()));
  const fraction = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
  return more.length === 0 && fraction(x) && fraction(y)
    ? { white: { x, y } }
    : { error: WHITE_HINT };
}

// POST /api/products/:id/colours/:key/swatch — a colour's material photo
// (PNG, JPEG or WebP, at most 15 MB), as the raw body (any image
// Content-Type) or a multipart form's `file`. `:id` is the product's Kiln id
// or its sku. The swatch hex stays; the photo's own colour comes back as
// `photoColour`, a suggestion. `?white=x,y` balances its light from a white
// or grey spot first; `?match=swatch` tints it to the swatch, the grain kept.
// 400 for a correction it cannot read, 404 for an unknown product or colour,
// 409 for a product from a catalog connector, 413 over the cap, 415 for
// anything but a PNG, JPEG or WebP, 422 for a correction the photo refuses
// (a coloured spot, a photo too far from the swatch).
export async function POST(request: Request, { params }: Context) {
  const denied = await authorize(request);
  if (denied) return denied;
  const { id, key } = await params;
  const fix = fixOf(new URL(request.url));
  if (fix && "error" in fix) return apiError(400, fix.error);
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
  const outcome = await setColourSwatch(id, key, photo, fix ?? undefined);
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

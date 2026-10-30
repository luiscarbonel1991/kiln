import { bearerToken, verifyAccessToken } from "@/server/access-tokens";

// What Kiln's HTTP API routes share (README "HTTP API"): a personal access
// token on every call, errors as { error } in words, bodies read under a cap.

const NO_STORE = { "Cache-Control": "no-store" };

export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function apiError(
  status: number,
  error: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

// Null when the request carries a token of the current maker; otherwise the
// 401 to send back, saying what is missing.
export async function authorize(request: Request): Promise<Response | null> {
  const caller = await authorizeToken(request);
  return caller instanceof Response ? caller : null;
}

// The token a request carries, if it is one of the current maker's; otherwise
// the 401 to send back.
export async function authorizeToken(
  request: Request,
): Promise<
  { tokenId: string; tokenName: string; canSpend: boolean } | Response
> {
  const token = bearerToken(request.headers.get("authorization"));
  const verified = token ? await verifyAccessToken(token) : null;
  if (verified) {
    return {
      tokenId: verified.tokenId,
      tokenName: verified.name,
      canSpend: verified.canSpend,
    };
  }
  return apiError(
    401,
    token
      ? "That token is not valid here: it was revoked, or it was made for another maker."
      : "Send a personal access token: Authorization: Bearer kiln_pat_... (make one in Settings → Access tokens).",
    { "WWW-Authenticate": 'Bearer realm="kiln"' },
  );
}

// The request's body, or null when it is larger than `max` bytes: a declared
// length over it is refused before reading, and reading stops once it passes.
export async function readBody(
  request: Request,
  max: number,
): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const megabytes = (bytes: number) => `${bytes / (1024 * 1024)} MB`;

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

// A request a page on another origin sent (its Origin header names another
// host). A request with no Origin (a script, the CLI) is not one.
export function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const { hostname, host } = new URL(origin);
    return !LOCAL.has(hostname) && host !== request.headers.get("host");
  } catch {
    return true;
  }
}

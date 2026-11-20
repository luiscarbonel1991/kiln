import { createHash, randomBytes } from "node:crypto";

// The shape of a personal access token, apart from where tokens are kept, so
// the code that finds the maker behind a request can read one without
// importing the token repository (which itself needs the current maker).

export const TOKEN_PREFIX = "kiln_pat_";
const TOKEN_PATTERN = /^kiln_pat_[A-Za-z0-9_-]{43}$/;

// The characters Settings shows to tell tokens apart.
const SHOWN = TOKEN_PREFIX.length + 4;

export function newToken(): { token: string; prefix: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, prefix: token.slice(0, SHOWN), hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The token an Authorization header carries, or null: "Bearer <token>", the
// scheme in any case, the token in Kiln's shape.
export function bearerToken(header: string | null): string | null {
  const match = header?.trim().match(/^bearer\s+(\S+)$/i);
  const token = match?.[1] ?? null;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

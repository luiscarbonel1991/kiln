import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { assertDatabaseUrl, db } from "@/lib/db";
import { getCurrentMaker } from "@/server/maker-repository";

// Personal access tokens for Kiln's HTTP API (ROADMAP 2026-10-26, P0-1): what
// a script, an agent, a scheduled job or another system sends as
// `Authorization: Bearer kiln_pat_...` to import a package or a material photo
// without a file picker. A token acts for the maker it was made for. Only its
// SHA-256 is stored: a token is 32 random bytes, so a fast hash is enough, and
// a leaked table gives nothing to send. Shown once, when it is made.

export const TOKEN_PREFIX = "kiln_pat_";
const TOKEN_PATTERN = /^kiln_pat_[A-Za-z0-9_-]{43}$/;

// The characters Settings shows to tell tokens apart.
const SHOWN = TOKEN_PREFIX.length + 4;

export const TokenName = z
  .string()
  .trim()
  .min(1, "Name the token after what will use it.")
  .max(60, "At most 60 characters.");

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

export interface AccessTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const SELECT = {
  id: true,
  name: true,
  prefix: true,
  createdAt: true,
  lastUsedAt: true,
} as const;

function view(row: {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}): AccessTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

// The current maker's tokens, newest first.
export async function listAccessTokens(): Promise<AccessTokenView[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.accessToken.findMany({
    where: { makerId: maker.id },
    select: SELECT,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(view);
}

// Make a token for the current maker: the token itself is returned this once.
export async function createAccessToken(
  name: string,
): Promise<{ token: string; created: AccessTokenView }> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const { token, prefix, hash } = newToken();
  const row = await db.accessToken.create({
    data: { makerId: maker.id, name: TokenName.parse(name), prefix, hash },
    select: SELECT,
  });
  return { token, created: view(row) };
}

// Revoke (delete) one of the current maker's tokens; false when it was not
// there. A call already on its way with it finishes; the next is refused.
export async function revokeAccessToken(id: string): Promise<boolean> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const { count } = await db.accessToken.deleteMany({
    where: { id, makerId: maker.id },
  });
  return count > 0;
}

// The token behind a request, if it is one of the current maker's: its id,
// with its last use stamped. Null for anything else (unknown, revoked, made
// for another maker, not a token).
export async function verifyAccessToken(
  token: string,
): Promise<{ tokenId: string; makerId: string } | null> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const row = await db.accessToken.findUnique({
    where: { hash: hashToken(token) },
    select: { id: true, makerId: true },
  });
  if (!row || row.makerId !== maker.id) return null;
  await db.accessToken.updateMany({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return { tokenId: row.id, makerId: row.makerId };
}

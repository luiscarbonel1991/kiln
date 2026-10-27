import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// What Kiln keeps that must not sit in the clear (a connected shop's OAuth
// tokens), sealed with AES-256-GCM under KILN_SECRET_KEY. A sealed value names
// what it holds (`purpose`, bound as associated data), so an access token
// cannot be read back as a refresh token. Format: v1.<iv>.<tag>.<ciphertext>,
// base64url.

export class SecretKeyMissing extends Error {
  readonly name = "SecretKeyMissing";
  constructor() {
    super(
      "Kiln has no KILN_SECRET_KEY to keep a shop's access sealed: add one to .env (openssl rand -base64 32) and restart Kiln.",
    );
  }
}

export const hasSecretKey = () => Boolean(env.KILN_SECRET_KEY);

function key(): Buffer {
  if (!env.KILN_SECRET_KEY) throw new SecretKeyMissing();
  const bytes = Buffer.from(env.KILN_SECRET_KEY, "base64");
  if (bytes.length !== 32) {
    throw new Error(
      "KILN_SECRET_KEY must be 32 bytes in base64 (openssl rand -base64 32).",
    );
  }
  return bytes;
}

export function seal(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    sealed.toString("base64url"),
  ].join(".");
}

// Throws when the value was sealed under another key or purpose, or changed.
export function unseal(value: string, purpose: string): string {
  const [version, iv, tag, sealed] = value.split(".");
  if (version !== "v1" || !iv || !tag || sealed === undefined) {
    throw new Error("Not a sealed value.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

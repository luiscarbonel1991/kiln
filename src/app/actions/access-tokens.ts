"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  createAccessToken,
  revokeAccessToken,
  TokenName,
} from "@/server/access-tokens";

// Settings → Access tokens. Zod is the trust boundary. The token comes back
// this once; Kiln keeps only its hash.
export async function createAccessTokenAction(
  input: unknown,
): Promise<{ token: string } | { error: string }> {
  const parsed = TokenName.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Name the token." };
  }
  const { token } = await createAccessToken(parsed.data);
  refresh();
  return { token };
}

export async function revokeAccessTokenAction(
  input: unknown,
): Promise<{ error?: string }> {
  const parsed = z.string().min(1).safeParse(input);
  if (!parsed.success) return { error: "Which token?" };
  const revoked = await revokeAccessToken(parsed.data);
  refresh();
  return revoked ? {} : { error: "That token was already revoked." };
}

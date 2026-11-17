"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  createAccessToken,
  revokeAccessToken,
  setTokenSpend,
  TokenName,
} from "@/server/access-tokens";
import { requireMaker } from "@/server/session";

// Settings → Access tokens. Zod is the trust boundary. The token comes back
// this once; Kiln keeps only its hash.
const NewToken = z.object({ name: TokenName, canSpend: z.boolean() });

export async function createAccessTokenAction(
  input: unknown,
): Promise<{ token: string } | { error: string }> {
  await requireMaker();
  const parsed = NewToken.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Name the token." };
  }
  const { token } = await createAccessToken(
    parsed.data.name,
    parsed.data.canSpend,
  );
  refresh();
  return { token };
}

export async function revokeAccessTokenAction(
  input: unknown,
): Promise<{ error?: string }> {
  await requireMaker();
  const parsed = z.string().min(1).safeParse(input);
  if (!parsed.success) return { error: "Which token?" };
  const revoked = await revokeAccessToken(parsed.data);
  refresh();
  return revoked ? {} : { error: "That token was already revoked." };
}

const Spend = z.object({ id: z.string().min(1), canSpend: z.boolean() });

// Let a token run paid tools (after a quote, within the cap), or stop it.
export async function setTokenSpendAction(
  input: unknown,
): Promise<{ error?: string }> {
  await requireMaker();
  const parsed = Spend.safeParse(input);
  if (!parsed.success) return { error: "Which token?" };
  const changed = await setTokenSpend(parsed.data.id, parsed.data.canSpend);
  refresh();
  return changed ? {} : { error: "That token was revoked." };
}

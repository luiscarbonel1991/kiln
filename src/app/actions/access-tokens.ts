"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  createAccessToken,
  revokeAccessToken,
  setTokenSpend,
  TokenName,
} from "@/server/access-tokens";
import { makerAction } from "@/server/guarded";

// Settings → Access tokens. Zod is the trust boundary. The token comes back
// this once; Kiln keeps only its hash.
const NewToken = z.object({ name: TokenName, canSpend: z.boolean() });

export const createAccessTokenAction = makerAction(
  async (
    maker,
    input: unknown,
  ): Promise<{ token: string } | { error: string }> => {
    const parsed = NewToken.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Name the token." };
    }
    const { token } = await createAccessToken(
      maker,
      parsed.data.name,
      parsed.data.canSpend,
    );
    refresh();
    return { token };
  },
);

export const revokeAccessTokenAction = makerAction(
  async (maker, input: unknown): Promise<{ error?: string }> => {
    const parsed = z.string().min(1).safeParse(input);
    if (!parsed.success) return { error: "Which token?" };
    const revoked = await revokeAccessToken(maker, parsed.data);
    refresh();
    return revoked ? {} : { error: "That token was already revoked." };
  },
);

const Spend = z.object({ id: z.string().min(1), canSpend: z.boolean() });

// Let a token run paid tools (after a quote, within the cap), or stop it.
export const setTokenSpendAction = makerAction(
  async (maker, input: unknown): Promise<{ error?: string }> => {
    const parsed = Spend.safeParse(input);
    if (!parsed.success) return { error: "Which token?" };
    const changed = await setTokenSpend(
      maker,
      parsed.data.id,
      parsed.data.canSpend,
    );
    refresh();
    return changed ? {} : { error: "That token was revoked." };
  },
);

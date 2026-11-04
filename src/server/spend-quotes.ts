import type { Prisma } from "@prisma/client";
import { assertDatabaseUrl, db } from "@/lib/db";
import { getCurrentMaker } from "@/server/maker-repository";

// A paid tool runs in two calls: `quote` stores the action, its input and its
// estimate here and answers an id; the paid tool takes only that id and runs
// what was quoted, once, before the quote expires. Every read and write is
// scoped to the current maker.

export const QUOTE_MINUTES = 30;

export const QUOTE_ACTIONS = [
  "generate",
  "draw",
  "write_listing",
  "review_product",
] as const;
export type QuoteAction = (typeof QUOTE_ACTIONS)[number];

export interface StoredQuote {
  id: string;
  action: QuoteAction;
  input: unknown;
  typicalMicros: number;
  maxMicros: number;
  expiresAt: Date;
}

// Why a quote cannot run, in words an agent can act on.
export class QuoteRefusal extends Error {}

export async function createQuote(
  quote: {
    action: QuoteAction;
    input: Prisma.InputJsonValue;
    typicalMicros: number;
    maxMicros: number;
    tokenId: string | null;
  },
  now = new Date(),
): Promise<{ id: string; expiresAt: Date }> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  return db.spendQuote.create({
    data: {
      ...quote,
      makerId: maker.id,
      expiresAt: new Date(now.getTime() + QUOTE_MINUTES * 60_000),
    },
    select: { id: true, expiresAt: true },
  });
}

// Take a quote for its action: the one write that marks it used, so two
// calls with the same id cannot both run it. A refusal says why.
export async function claimQuote(
  id: string,
  action: QuoteAction,
  now = new Date(),
): Promise<StoredQuote> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const { count } = await db.spendQuote.updateMany({
    where: {
      id,
      makerId: maker.id,
      action,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  const row = await db.spendQuote.findFirst({
    where: { id, makerId: maker.id },
    select: {
      id: true,
      action: true,
      input: true,
      typicalMicros: true,
      maxMicros: true,
      expiresAt: true,
      usedAt: true,
    },
  });
  if (count === 1 && row) {
    const { usedAt: _used, ...quote } = row;
    return { ...quote, action };
  }
  if (!row)
    throw new QuoteRefusal("No quote of yours has that id: quote first.");
  if (row.action !== action) {
    throw new QuoteRefusal(
      `That quote is for ${row.action}, not ${action}: quote ${action} first.`,
    );
  }
  if (row.usedAt)
    throw new QuoteRefusal("That quote was used already: quote again.");
  throw new QuoteRefusal(
    `That quote expired at ${row.expiresAt.toISOString()}: quote again.`,
  );
}

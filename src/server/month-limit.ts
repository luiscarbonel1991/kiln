import { canAfford } from "@/domain/generation-cost";
import { db } from "@/lib/db";
import { overLimitLine } from "@/lib/month-limit-words";
import {
  type Budget,
  budget,
  QueueRefusal,
} from "@/server/generation-repository";
import type { MakerRef } from "@/server/maker-repository";
import { roleOf } from "@/server/organization";

// What a caller may know of this month's limit (Luis, 2026-11-17). The owner,
// and a token or a script (made by the owner), read the studio's amounts; a
// member reads only whether their work fits and whom to ask, never the cap,
// what is spent or queued, or what is left.

export type MonthLimit =
  | ({ whose: "studio" } & Budget)
  | { whose: "member"; ask: string };

// The owner, or work with no person behind it.
export const readsStudioAmounts = (maker: MakerRef): boolean =>
  !maker.member || maker.member.role === "owner";

// The studio owner's first name, or "the studio's owner" when Kiln cannot
// name them (no team yet, no name).
export async function whomToAsk(maker: MakerRef): Promise<string> {
  const people = await db.member.findMany({
    where: { organization: { maker: { is: { id: maker.id } } } },
    orderBy: { createdAt: "asc" },
    select: { role: true, user: { select: { name: true } } },
  });
  // The role exactly, as one of its comma-separated parts (roleOf).
  const owner = people.find((p) => roleOf(p.role) === "owner");
  const first = owner?.user.name.trim().split(/\s+/)[0];
  return first || "the studio's owner";
}

// Whom a member asks, or null for the owner and for work with no person
// behind it: who reads decides the words (provider-key-words.ts).
export async function memberAsk(maker: MakerRef): Promise<string | null> {
  return readsStudioAmounts(maker) ? null : await whomToAsk(maker);
}

export async function monthLimit(maker: MakerRef): Promise<MonthLimit> {
  if (!readsStudioAmounts(maker)) {
    return { whose: "member", ask: await whomToAsk(maker) };
  }
  return { whose: "studio", ...(await budget(maker.id)) };
}

// Whether work that costs at most `requestMicros` fits what is left of this
// month's limit, by the queue's own rule (spent and queued count).
export async function fitsThisMonth(
  maker: MakerRef,
  requestMicros: number,
): Promise<boolean> {
  return canAfford({ ...(await budget(maker.id)), requestMicros });
}

// The cap's refusal in a member's words: whom to ask, and no amount. The
// owner's, a token's and a script's stay as the queue says them.
export async function inMembersWords(
  maker: MakerRef,
  error: unknown,
): Promise<unknown> {
  if (
    error instanceof QueueRefusal &&
    error.reason === "cap" &&
    !readsStudioAmounts(maker)
  ) {
    return new QueueRefusal("cap", `${overLimitLine(await whomToAsk(maker))}.`);
  }
  return error;
}

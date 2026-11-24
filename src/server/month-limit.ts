import { canAfford } from "@/domain/generation-cost";
import { overLimitLine } from "@/lib/month-limit-words";
import {
  type Budget,
  budget,
  QueueRefusal,
} from "@/server/generation-repository";
import type { MakerRef } from "@/server/maker-repository";
import { readsStudioAmounts, whomToAsk } from "@/server/studio-owner";

export {
  memberAsk,
  readsStudioAmounts,
  whomToAsk,
} from "@/server/studio-owner";

// What a caller may know of this month's limit (Luis, 2026-11-17). The owner,
// and a token or a script (made by the owner), read the studio's amounts; a
// member reads only whether their work fits and whom to ask, never the cap,
// what is spent or queued, or what is left.

export type MonthLimit =
  | ({ whose: "studio" } & Budget)
  | { whose: "member"; ask: string };

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

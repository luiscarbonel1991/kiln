import { db } from "@/lib/db";
import type { MakerRef } from "@/server/maker-repository";
import { roleOf } from "@/server/organization";

// Who reads the studio as its owner, and whom everyone else asks. Its own
// module so the queue's repository can read it without an import cycle
// (month-limit.ts reads the queue's budget, and re-exports these).

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

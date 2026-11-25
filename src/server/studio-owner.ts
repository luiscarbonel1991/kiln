import { db } from "@/lib/db";
import type { MakerRef } from "@/server/maker-repository";
import { roleOf } from "@/server/organization";

// Who reads the studio as its owner, and whom everyone else asks. Its own
// module so the queue's repository can read it without an import cycle
// (month-limit.ts reads the queue's budget, and re-exports these).

// The owner, or work with no person behind it.
export const readsStudioAmounts = (maker: MakerRef): boolean =>
  !maker.member || maker.member.role === "owner";

export interface OwnerContact {
  name: string;
  firstName: string;
  email: string;
}

// The studio's owner as a person the team can reach: their name and email,
// read through the studio handed down; null when the studio has no team.
export async function ownerContact(
  maker: MakerRef,
): Promise<OwnerContact | null> {
  const people = await db.member.findMany({
    where: { organization: { maker: { is: { id: maker.id } } } },
    orderBy: { createdAt: "asc" },
    select: { role: true, user: { select: { name: true, email: true } } },
  });
  // The role exactly, as one of its comma-separated parts (roleOf).
  const owner = people.find((p) => roleOf(p.role) === "owner");
  if (!owner) return null;
  const name = owner.user.name.trim();
  return {
    name,
    firstName: name.split(/\s+/)[0] ?? "",
    email: owner.user.email,
  };
}

// The studio owner's first name, or "the studio's owner" when Kiln cannot
// name them (no team yet, no name).
export async function whomToAsk(maker: MakerRef): Promise<string> {
  return (await ownerContact(maker))?.firstName || "the studio's owner";
}

// Whom a member asks, or null for the owner and for work with no person
// behind it: who reads decides the words (provider-key-words.ts).
export async function memberAsk(maker: MakerRef): Promise<string | null> {
  return readsStudioAmounts(maker) ? null : await whomToAsk(maker);
}

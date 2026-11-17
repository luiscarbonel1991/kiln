import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// The organization behind an instance: the maker's company and its members
// (Better Auth's tables), tied one to one to the Maker that owns the work.

// Whether this instance has its owner: an organization exists.
export async function instanceClaimed(): Promise<boolean> {
  return (await db.organization.count()) > 0;
}

function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "studio";
}

export class AlreadyClaimed extends Error {
  readonly name = "AlreadyClaimed";
  constructor() {
    super("This Kiln already has its owner.");
  }
}

// The instance's first account takes it: their company becomes the
// organization, they its owner, and the maker this instance already worked
// for (KILN_MAKER, with everything it holds) becomes that organization's. In
// one transaction; a second claim finds the maker taken and changes nothing.
export async function claimInstance(input: {
  userId: string;
  company: string;
}): Promise<{ organizationId: string }> {
  const organizationId = randomUUID();
  const now = new Date();
  await db.$transaction(async (tx) => {
    const maker = await tx.maker.upsert({
      where: { slug: env.KILN_MAKER },
      create: { slug: env.KILN_MAKER, name: input.company },
      update: {},
      select: { id: true, name: true, organizationId: true },
    });
    if (maker.organizationId) throw new AlreadyClaimed();
    await tx.organization.create({
      data: {
        id: organizationId,
        name: input.company,
        slug: `${slugOf(input.company)}-${organizationId.slice(0, 6)}`,
        createdAt: now,
      },
    });
    await tx.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: input.userId,
        role: "owner",
        createdAt: now,
      },
    });
    const { count } = await tx.maker.updateMany({
      where: { id: maker.id, organizationId: null },
      data: {
        organizationId,
        ...(maker.name === "My studio" ? { name: input.company } : {}),
      },
    });
    if (count === 0) throw new AlreadyClaimed();
  });
  return { organizationId };
}

// The maker a signed-in person works for: their session's organization, else
// the first they belong to. Null when they belong to none.
export async function makerOfMember(input: {
  userId: string;
  activeOrganizationId?: string | null;
}): Promise<{ id: string; slug: string; name: string } | null> {
  const members = await db.member.findMany({
    where: { userId: input.userId },
    orderBy: { createdAt: "asc" },
    select: {
      organizationId: true,
      organization: {
        select: { maker: { select: { id: true, slug: true, name: true } } },
      },
    },
  });
  const chosen =
    members.find((m) => m.organizationId === input.activeOrganizationId) ??
    members[0];
  return chosen?.organization.maker ?? null;
}

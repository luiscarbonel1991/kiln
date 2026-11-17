import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getAuth } from "@/server/auth";
import type { CurrentMaker } from "@/server/maker-repository";

// The studio's team: the people of the organization behind a maker, and the
// invitations waiting for someone to join. Kiln sends no mail: an invitation
// is a link the owner copies and passes on, which opens the join page.

export interface TeamMemberView {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  joinedAt: string;
  you: boolean;
}

export interface InvitationView {
  id: string;
  email: string;
  expiresAt: string;
  // The join page, from the instance's root.
  path: string;
}

export interface TeamView {
  studio: string;
  members: TeamMemberView[];
  invitations: InvitationView[];
}

export const invitationPath = (id: string) => `/invite/${id}`;

// Pending and not expired: an invitation that can still be used.
const usable = (
  invitation: { status: string; expiresAt: Date } | null,
): invitation is { status: string; expiresAt: Date } =>
  invitation?.status === "pending" && invitation.expiresAt > new Date();

async function organizationOf(maker: CurrentMaker): Promise<string> {
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { organizationId: true },
  });
  if (!row?.organizationId) throw new Error("This studio has no team yet.");
  return row.organizationId;
}

export async function listTeam(maker: CurrentMaker): Promise<TeamView> {
  const organizationId = await organizationOf(maker);
  const [organization, members, invitations] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    }),
    db.member.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    db.invitation.findMany({
      where: {
        organizationId,
        status: "pending",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, expiresAt: true },
    }),
  ]);
  return {
    studio: organization.name,
    members: members.map((m) => ({
      id: m.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role.split(",").includes("owner") ? "owner" : "member",
      joinedAt: m.createdAt.toISOString(),
      you: m.id === maker.member?.id,
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      expiresAt: i.expiresAt.toISOString(),
      path: invitationPath(i.id),
    })),
  };
}

// Better Auth's refusals, in Kiln's words where they matter to the owner.
function inWords(error: unknown): Error {
  if (!(error instanceof APIError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const message = String(error.body?.message ?? error.message);
  if (/already a member/i.test(message)) {
    return new Error("They are already on the team.");
  }
  if (/already invited/i.test(message)) {
    return new Error("They already have an invitation: copy its link below.");
  }
  return new Error(message);
}

// An invitation for one email, as a member (the owner role is not given by
// invitation). Better Auth checks the inviter may invite.
export async function inviteMember(
  maker: CurrentMaker,
  email: string,
): Promise<InvitationView> {
  const organizationId = await organizationOf(maker);
  try {
    const made = await getAuth().api.createInvitation({
      headers: await headers(),
      body: { email, role: "member", organizationId },
    });
    return {
      id: made.id,
      email: made.email,
      expiresAt: new Date(made.expiresAt).toISOString(),
      path: invitationPath(made.id),
    };
  } catch (error) {
    throw inWords(error);
  }
}

export async function cancelInvitation(
  maker: CurrentMaker,
  invitationId: string,
): Promise<void> {
  const organizationId = await organizationOf(maker);
  const found = await db.invitation.findFirst({
    where: { id: invitationId, organizationId },
    select: { id: true },
  });
  if (!found) throw new Error("That invitation is not this studio's.");
  try {
    await getAuth().api.cancelInvitation({
      headers: await headers(),
      body: { invitationId },
    });
  } catch (error) {
    throw inWords(error);
  }
}

// Take someone off the team. The owner stays: Kiln has one owner for now.
export async function removeMember(
  maker: CurrentMaker,
  memberId: string,
): Promise<void> {
  const organizationId = await organizationOf(maker);
  const found = await db.member.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true },
  });
  if (!found) throw new Error("They are not on this team.");
  if (found.role.split(",").includes("owner")) {
    throw new Error("The owner stays on the team.");
  }
  try {
    await getAuth().api.removeMember({
      headers: await headers(),
      body: { memberIdOrEmail: memberId, organizationId },
    });
  } catch (error) {
    throw inWords(error);
  }
  // Their sessions stop working at once: every request looks the membership
  // up, and finds none (they land on the sign-in page).
}

export interface OpenInvitation {
  id: string;
  email: string;
  studio: string;
  // Who made it, to welcome the person by name.
  inviter: string;
  hasAccount: boolean;
}

// What the join page reads about an invitation, without a session: the link
// is the secret. `open` is null when it is used, cancelled or expired; then
// only who to ask for a new one is told. Null when the link is unknown.
export async function readInvitation(invitationId: string): Promise<{
  open: OpenInvitation | null;
  inviter: string;
  studio: string;
} | null> {
  const found = await db.invitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true } },
      inviter: { select: { name: true } },
    },
  });
  if (!found) return null;
  const studio = found.organization.name;
  const inviter = found.inviter.name;
  if (!usable(found)) return { open: null, inviter, studio };
  const account = await db.user.findUnique({
    where: { email: found.email.toLowerCase() },
    select: { id: true },
  });
  return {
    inviter,
    studio,
    open: {
      id: found.id,
      email: found.email,
      studio,
      inviter,
      hasAccount: Boolean(account),
    },
  };
}

// An invitation that can still be used, or null.
export async function openInvitation(
  invitationId: string,
): Promise<OpenInvitation | null> {
  return (await readInvitation(invitationId))?.open ?? null;
}

// The person behind `userId` joins the invitation's organization: in one
// transaction the invitation is taken (only while pending) and they become a
// member; their sessions open on it.
export async function joinWithInvitation(input: {
  invitationId: string;
  userId: string;
  email: string;
}): Promise<{ organizationId: string }> {
  return db.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { id: input.invitationId },
      select: {
        organizationId: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!invitation || !usable(invitation)) {
      throw new Error("That invitation was used, cancelled or has expired.");
    }
    if (invitation.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new Error(`That invitation is for ${invitation.email}.`);
    }
    const taken = await tx.invitation.updateMany({
      where: { id: input.invitationId, status: "pending" },
      data: { status: "accepted" },
    });
    if (taken.count === 0) {
      throw new Error("That invitation was used, cancelled or has expired.");
    }
    const already = await tx.member.findFirst({
      where: {
        organizationId: invitation.organizationId,
        userId: input.userId,
      },
      select: { id: true },
    });
    if (!already) {
      await tx.member.create({
        data: {
          id: randomUUID(),
          organizationId: invitation.organizationId,
          userId: input.userId,
          role: invitation.role ?? "member",
          createdAt: new Date(),
        },
      });
    }
    await tx.session.updateMany({
      where: { userId: input.userId },
      data: { activeOrganizationId: invitation.organizationId },
    });
    return { organizationId: invitation.organizationId };
  });
}

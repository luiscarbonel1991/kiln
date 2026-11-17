import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AuthCard } from "@/components/account/auth-card";
import { JoinButton } from "@/components/account/join-button";
import { JoinForm } from "@/components/account/join-form";
import { SwitchAccountButton } from "@/components/account/switch-account-button";
import { Button } from "@/components/ui/button";
import { hasDatabase } from "@/lib/db";
import { getAuth, hasAuthSecret } from "@/server/auth";
import { readInvitation } from "@/server/team";

export const metadata: Metadata = { title: "Join a studio · Kiln" };
export const dynamic = "force-dynamic";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function SignInButton({ next }: { next?: string }) {
  return (
    <Button
      asChild
      size="lg"
      data-testid="join-sign-in"
      className="h-10 w-full rounded-field shadow-button"
    >
      <Link
        href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}
      >
        Sign in
      </Link>
    </Button>
  );
}

// The page an invitation's link opens: a welcome to the studio, from the
// person who invited them. The link is the secret: anyone holding it may make
// the account for its email (or join with that account, signed in), and
// nothing else. Every state ends on something to do.
export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!hasDatabase() || !hasAuthSecret()) {
    return (
      <AuthCard
        title="Kiln is not set up yet"
        lead="It needs DATABASE_URL and KILN_SECRET_KEY in .env before anyone can join."
      >
        {null}
      </AuthCard>
    );
  }
  const { id } = await params;
  const read = await readInvitation(id);
  if (!read) {
    return (
      <AuthCard
        title="This link does not lead anywhere"
        lead="Check that it was copied whole, or ask whoever sent it for a new one. Already on a studio here? Sign in."
      >
        <SignInButton />
      </AuthCard>
    );
  }
  const invitation = read.open;
  const eyebrow = `${first(read.inviter)} invited you`;
  if (!invitation) {
    return (
      <AuthCard
        eyebrow={eyebrow}
        title="This link was already used"
        lead={`Or it was cancelled, or its 7 days ran out. Ask ${first(read.inviter)} for a new one. If you already joined ${read.studio}, sign in.`}
      >
        <SignInButton />
      </AuthCard>
    );
  }
  const path = `/invite/${invitation.id}`;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) {
    if (session.user.email.toLowerCase() === invitation.email.toLowerCase()) {
      return (
        <AuthCard
          eyebrow={eyebrow}
          title={invitation.studio}
          lead="Join and you will work on the studio's products and projects with them."
        >
          <JoinButton invitationId={invitation.id} studio={invitation.studio} />
        </AuthCard>
      );
    }
    return (
      <AuthCard
        eyebrow={eyebrow}
        title={invitation.studio}
        lead={`This invitation is for ${invitation.email}, and you are signed in as ${session.user.email}.`}
      >
        <SwitchAccountButton />
      </AuthCard>
    );
  }
  if (invitation.hasAccount) {
    return (
      <AuthCard
        eyebrow={eyebrow}
        title={invitation.studio}
        lead={`${invitation.email} already has an account here. Sign in, and you come back to this page to join.`}
      >
        <SignInButton next={path} />
      </AuthCard>
    );
  }
  return (
    <AuthCard
      eyebrow={eyebrow}
      title={invitation.studio}
      lead="Make your account and you will work on the studio's products and projects with them."
    >
      <JoinForm invitationId={invitation.id} email={invitation.email} />
    </AuthCard>
  );
}

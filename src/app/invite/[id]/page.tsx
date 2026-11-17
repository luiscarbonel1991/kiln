import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AuthCard } from "@/components/account/auth-card";
import { JoinButton } from "@/components/account/join-button";
import { JoinForm } from "@/components/account/join-form";
import { SignOutButton } from "@/components/account/sign-out-button";
import { Button } from "@/components/ui/button";
import { hasDatabase } from "@/lib/db";
import { getAuth, hasAuthSecret } from "@/server/auth";
import { openInvitation } from "@/server/team";

export const metadata: Metadata = { title: "Join a studio · Kiln" };
export const dynamic = "force-dynamic";

// The page an invitation's link opens. The link is the secret: anyone holding
// it may make the account for its email (or join with that account, signed
// in), and nothing else.
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
  const invitation = await openInvitation(id);
  if (!invitation) {
    return (
      <AuthCard
        title="This invitation cannot be used"
        lead="It was used, cancelled or has expired. Ask the studio's owner for a new link."
      >
        {null}
      </AuthCard>
    );
  }
  const title = `Join ${invitation.studio}`;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) {
    if (session.user.email.toLowerCase() === invitation.email.toLowerCase()) {
      return (
        <AuthCard
          title={title}
          lead={`You are signed in as ${invitation.email}. Joining opens the studio's products and projects.`}
        >
          <JoinButton invitationId={invitation.id} studio={invitation.studio} />
        </AuthCard>
      );
    }
    return (
      <AuthCard
        title={title}
        lead={`This invitation is for ${invitation.email}, and you are signed in as ${session.user.email}. Sign out, then open the link again.`}
      >
        <div className="flex items-center gap-2 font-sans text-sm text-on-surface-mid">
          <SignOutButton /> Sign out
        </div>
      </AuthCard>
    );
  }
  if (invitation.hasAccount) {
    return (
      <AuthCard
        title={title}
        lead={`${invitation.email} already has an account on this Kiln. Sign in with it, and you come back here to join.`}
      >
        <Button
          asChild
          size="lg"
          data-testid="join-sign-in"
          className="h-10 w-full rounded-field shadow-button"
        >
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/invite/${invitation.id}`)}`}
          >
            Sign in to join
          </Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={title}
      lead="Make your account for this studio. You will see its products and projects."
    >
      <JoinForm invitationId={invitation.id} email={invitation.email} />
    </AuthCard>
  );
}

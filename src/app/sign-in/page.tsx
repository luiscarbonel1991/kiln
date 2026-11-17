import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/account/auth-card";
import { SignInForm } from "@/components/account/sign-in-form";
import { hasDatabase } from "@/lib/db";
import { getAuth, hasAuthSecret } from "@/server/auth";
import { instanceClaimed, makerOfMember } from "@/server/organization";

export const metadata: Metadata = { title: "Sign in · Kiln" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string }>;
}) {
  if (!hasDatabase() || !hasAuthSecret()) {
    return (
      <AuthCard
        title="Kiln is not set up yet"
        lead="It needs DATABASE_URL and KILN_SECRET_KEY in .env before anyone can sign in. The README's install steps set both."
      >
        {null}
      </AuthCard>
    );
  }
  if (!(await instanceClaimed())) redirect("/sign-up");
  const session = await getAuth().api.getSession({ headers: await headers() });
  const belongs = session
    ? await makerOfMember({
        userId: session.user.id,
        activeOrganizationId: session.session.activeOrganizationId,
      })
    : null;
  if (belongs) redirect("/projects");
  const { left } = await searchParams;
  return (
    <AuthCard title="Sign in" lead="Your studio is where you left it.">
      <SignInForm
        notice={
          left && session
            ? "Your account belongs to no organization on this Kiln. Ask its owner for an invitation, or sign in with another account."
            : undefined
        }
      />
    </AuthCard>
  );
}

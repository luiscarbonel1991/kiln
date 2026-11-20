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

// Where to go after signing in, when it is an invitation's join page: never
// an address elsewhere.
const safeNext = (next: unknown): string | undefined =>
  typeof next === "string" && /^\/invite\/[\w-]{1,100}$/.test(next)
    ? next
    : undefined;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; next?: string }>;
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
  const { left, next: asked } = await searchParams;
  const next = safeNext(asked);
  if (session && next) redirect(next);
  if (belongs) redirect("/projects");
  return (
    <AuthCard title="Sign in" lead="Your studio is where you left it.">
      <SignInForm
        next={next}
        notice={
          left && session
            ? "You are not on a studio here any more. Ask its owner for a new invitation, or sign in with another account."
            : undefined
        }
      />
    </AuthCard>
  );
}

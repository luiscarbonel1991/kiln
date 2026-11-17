import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/account/auth-card";
import { SignUpForm } from "@/components/account/sign-up-form";
import { hasDatabase } from "@/lib/db";
import { hasAuthSecret } from "@/server/auth";
import { instanceClaimed } from "@/server/organization";

export const metadata: Metadata = { title: "Set up · Kiln" };
export const dynamic = "force-dynamic";

// The first run only: once the instance has its owner, people join by
// invitation and this page sends them to sign in.
export default async function SignUpPage() {
  if (!hasDatabase() || !hasAuthSecret()) redirect("/sign-in");
  if (await instanceClaimed()) redirect("/sign-in");
  return (
    <AuthCard
      title="Set up this Kiln"
      lead="The first account owns it. Your company becomes the organization, and the products and projects already here become its work."
    >
      <SignUpForm />
    </AuthCard>
  );
}

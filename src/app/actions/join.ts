"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { type FieldErrors, fieldErrors, JoinForm } from "@/lib/account-forms";
import { getAuth, INVITATION_HEADER } from "@/server/auth";
import { getRequestMaker } from "@/server/maker-repository";
import { joinWithInvitation, openInvitation } from "@/server/team";

// The join page's actions. They run without a session (the invitation's link
// is the secret), so each checks the invitation itself.

type JoinValues = z.infer<typeof JoinForm>;

export interface JoinRefusal {
  error: string | null;
  fields: FieldErrors<JoinValues>;
}

const GONE = "That invitation was used, cancelled or has expired.";

// Someone new: their account is made for the invitation's email, and they
// join its studio. On success they are sent to its projects.
export async function joinAsNewAccount(
  invitationId: string,
  input: unknown,
): Promise<JoinRefusal> {
  const refuse = (error: string): JoinRefusal => ({ error, fields: {} });
  const invitation = await openInvitation(String(invitationId));
  if (!invitation) return refuse(GONE);
  if (invitation.hasAccount) {
    return refuse("That email already has an account: sign in to join.");
  }
  const parsed = JoinForm.safeParse(input);
  if (!parsed.success)
    return { error: null, fields: fieldErrors(parsed.error) };
  const forwarded = new Headers(await headers());
  forwarded.set(INVITATION_HEADER, invitation.id);
  try {
    const { user } = await getAuth().api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: invitation.email,
        password: parsed.data.password,
      },
      headers: forwarded,
    });
    await joinWithInvitation({
      invitationId: invitation.id,
      userId: user.id,
      email: user.email,
    });
  } catch (error) {
    if (error instanceof APIError || error instanceof Error) {
      return refuse(error.message || "That account could not be made.");
    }
    throw error;
  }
  redirect("/projects");
}

// Someone signed in with the invitation's email joins its studio.
export async function joinSignedIn(invitationId: string): Promise<string> {
  const invitation = await openInvitation(String(invitationId));
  if (!invitation) return GONE;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return "Sign in first.";
  try {
    await joinWithInvitation({
      invitationId: invitation.id,
      userId: session.user.id,
      email: session.user.email,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (!(await getRequestMaker())) return "Sign in again to open the studio.";
  redirect("/projects");
}

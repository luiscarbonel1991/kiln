"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasDatabase } from "@/lib/db";
import { getAuth, hasAuthSecret, MIN_PASSWORD } from "@/server/auth";
import {
  AlreadyClaimed,
  claimInstance,
  instanceClaimed,
} from "@/server/organization";

const Owner = z.object({
  company: z.string().trim().min(1, "Name your company or studio.").max(80),
  name: z.string().trim().min(1, "Your name.").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("That is not an email.")),
  password: z
    .string()
    .min(MIN_PASSWORD, `At least ${MIN_PASSWORD} characters.`)
    .max(128),
});

export interface OwnerFormState {
  error: string | null;
}

const TAKEN = "This Kiln already has its owner. Ask them for an invitation.";

// The first run: the instance's first account. Their company becomes the
// organization and takes the work this instance already holds.
export async function createOwner(
  _prev: OwnerFormState,
  form: FormData,
): Promise<OwnerFormState> {
  if (!hasDatabase() || !hasAuthSecret()) {
    return {
      error:
        "Kiln needs DATABASE_URL and KILN_SECRET_KEY in .env before it can keep accounts.",
    };
  }
  const parsed = Owner.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  if (await instanceClaimed()) return { error: TAKEN };
  const { company, name, email, password } = parsed.data;
  try {
    const { user } = await getAuth().api.signUpEmail({
      body: { name, email, password },
      headers: await headers(),
    });
    await claimInstance({ userId: user.id, company });
  } catch (error) {
    if (error instanceof AlreadyClaimed) return { error: TAKEN };
    if (error instanceof APIError) {
      return { error: error.message || "That account could not be made." };
    }
    throw error;
  }
  redirect("/projects");
}

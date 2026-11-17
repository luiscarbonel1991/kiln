"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { type FieldErrors, fieldErrors, OwnerForm } from "@/lib/account-forms";
import { hasDatabase } from "@/lib/db";
import { getAuth, hasAuthSecret } from "@/server/auth";
import {
  AlreadyClaimed,
  claimInstance,
  instanceClaimed,
} from "@/server/organization";

export interface OwnerFormState {
  // A problem with the whole form (the instance is taken, the email is used).
  error: string | null;
  fields: FieldErrors<OwnerValues>;
  // What was typed, given back so a refused form is not emptied (never the
  // password).
  values: { company: string; name: string; email: string };
}

type OwnerValues = z.infer<typeof OwnerForm>;

const TAKEN = "This Kiln already has its owner. Ask them for an invitation.";

// The first run: the instance's first account. Their company becomes the
// organization and takes the work this instance already holds.
export async function createOwner(
  _prev: OwnerFormState,
  form: FormData,
): Promise<OwnerFormState> {
  const text = (key: string) => String(form.get(key) ?? "");
  const values = {
    company: text("company"),
    name: text("name"),
    email: text("email"),
  };
  const refuse = (error: string): OwnerFormState => ({
    error,
    fields: {},
    values,
  });
  if (!hasDatabase() || !hasAuthSecret()) {
    return refuse(
      "Kiln needs DATABASE_URL and KILN_SECRET_KEY in .env before it can keep accounts.",
    );
  }
  const parsed = OwnerForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: null, fields: fieldErrors(parsed.error), values };
  }
  if (await instanceClaimed()) return refuse(TAKEN);
  const { company, name, email, password } = parsed.data;
  try {
    const { user } = await getAuth().api.signUpEmail({
      body: { name, email, password },
      headers: await headers(),
    });
    await claimInstance({ userId: user.id, company });
  } catch (error) {
    if (error instanceof AlreadyClaimed) return refuse(TAKEN);
    if (error instanceof APIError) {
      return refuse(error.message || "That account could not be made.");
    }
    throw error;
  }
  redirect("/projects");
}

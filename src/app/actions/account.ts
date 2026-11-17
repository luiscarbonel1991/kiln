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

type OwnerValues = z.infer<typeof OwnerForm>;

// What a refused first-run form gets back: a problem with the whole form
// (the instance is taken, the email is used) or with single fields.
export interface OwnerRefusal {
  error: string | null;
  fields: FieldErrors<OwnerValues>;
}

const TAKEN = "This Kiln already has its owner. Ask them for an invitation.";

// The first run: the instance's first account. Their company becomes the
// organization and takes the work this instance already holds. On success the
// person is sent to their projects; otherwise the refusal comes back.
export async function createOwner(input: unknown): Promise<OwnerRefusal> {
  const refuse = (error: string): OwnerRefusal => ({ error, fields: {} });
  if (!hasDatabase() || !hasAuthSecret()) {
    return refuse(
      "Kiln needs DATABASE_URL and KILN_SECRET_KEY in .env before it can keep accounts.",
    );
  }
  const parsed = OwnerForm.safeParse(input);
  if (!parsed.success) {
    return { error: null, fields: fieldErrors(parsed.error) };
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

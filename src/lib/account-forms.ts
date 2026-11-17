import { z } from "zod";

// What the account forms take, checked the same way in the browser (at once,
// under each field) and on the server (which never trusts the browser).

export const MIN_PASSWORD = 10;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Your email.")
  .pipe(z.email("That does not look like an email."));

const password = z
  .string()
  .min(MIN_PASSWORD, `At least ${MIN_PASSWORD} characters.`)
  .max(128, "At most 128 characters.");

const name = z
  .string()
  .trim()
  .min(1, "Your name.")
  .max(80, "At most 80 characters.");

export const OwnerForm = z.object({
  company: z
    .string()
    .trim()
    .min(1, "Name your studio.")
    .max(80, "At most 80 characters."),
  name,
  email,
  password,
});

// Joining a studio by invitation: the email is the invitation's.
export const JoinForm = z.object({ name, password });

export const InviteForm = z.object({
  email: email.pipe(z.string().max(254, "At most 254 characters.")),
});

export const SignInForm = z.object({
  email,
  password: z.string().min(1, "Your password."),
});

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

// The first problem of each field, by field name.
export function fieldErrors<T>(error: z.ZodError<T>): FieldErrors<T> {
  const out: FieldErrors<T> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof T | undefined;
    if (key !== undefined && !out[key]) out[key] = issue.message;
  }
  return out;
}

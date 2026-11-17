"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField } from "@/components/account/auth-field";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import {
  type FieldErrors,
  fieldErrors,
  SignInForm as SignInFields,
} from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(notice ?? null);
  const [fields, setFields] = useState<
    FieldErrors<{ email: string; password: string }>
  >({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = SignInFields.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    setError(null);
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error));
      return;
    }
    setFields({});
    setBusy(true);
    const { error: failed } = await authClient.signIn.email(parsed.data);
    if (failed) {
      setBusy(false);
      setError(
        failed.status === 429
          ? "Too many tries. Wait a moment, then try again."
          : "That email and password do not match an account here.",
      );
      return;
    }
    router.replace("/projects");
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate data-testid="sign-in-form">
      <FieldGroup className="gap-4">
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          error={fields.email}
        />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={fields.password}
        />
        <FieldError data-testid="sign-in-error">{error}</FieldError>
        <Button
          type="submit"
          size="lg"
          disabled={busy}
          data-testid="sign-in-submit"
          className="h-10 w-full rounded-field shadow-button"
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}

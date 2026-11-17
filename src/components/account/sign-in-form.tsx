"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField } from "@/components/account/auth-field";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
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
    <form onSubmit={submit} data-testid="sign-in-form">
      <FieldGroup className="gap-4">
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FieldError>{error}</FieldError>
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

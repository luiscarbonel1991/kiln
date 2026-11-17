"use client";

import { useActionState } from "react";
import { createOwner, type OwnerFormState } from "@/app/actions/account";
import { AuthField } from "@/components/account/auth-field";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";

const START: OwnerFormState = { error: null };

export function SignUpForm({ minPassword }: { minPassword: number }) {
  const [state, action, busy] = useActionState(createOwner, START);
  return (
    <form action={action} data-testid="sign-up-form">
      <FieldGroup className="gap-4">
        <AuthField
          label="Company or studio"
          name="company"
          autoComplete="organization"
          required
          maxLength={80}
        />
        <AuthField
          label="Your name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
        />
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
          autoComplete="new-password"
          required
          minLength={minPassword}
          hint={`At least ${minPassword} characters.`}
        />
        <FieldError>{state.error}</FieldError>
        <Button
          type="submit"
          size="lg"
          disabled={busy}
          data-testid="sign-up-submit"
          className="h-10 w-full rounded-field shadow-button"
        >
          {busy ? "Setting up…" : "Create the owner account"}
        </Button>
      </FieldGroup>
    </form>
  );
}

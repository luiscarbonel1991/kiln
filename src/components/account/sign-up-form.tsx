"use client";

import { useActionState } from "react";
import { createOwner, type OwnerFormState } from "@/app/actions/account";
import {
  AuthError,
  AuthField,
  authSubmitClass,
} from "@/components/account/auth-card";

const START: OwnerFormState = { error: null };

export function SignUpForm({ minPassword }: { minPassword: number }) {
  const [state, action, busy] = useActionState(createOwner, START);
  return (
    <form action={action} className="space-y-4" data-testid="sign-up-form">
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
      <AuthError>{state.error}</AuthError>
      <button
        type="submit"
        disabled={busy}
        data-testid="sign-up-submit"
        className={authSubmitClass}
      >
        {busy ? "Setting up…" : "Create the owner account"}
      </button>
    </form>
  );
}

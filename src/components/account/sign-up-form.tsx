"use client";

import { useActionState } from "react";
import { createOwner, type OwnerFormState } from "@/app/actions/account";
import { AuthField } from "@/components/account/auth-field";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { fieldErrors, MIN_PASSWORD, OwnerForm } from "@/lib/account-forms";

const START: OwnerFormState = {
  error: null,
  fields: {},
  values: { company: "", name: "", email: "" },
};

// Checked in the browser first, so a problem shows under its field at once;
// the server checks again.
async function submit(
  prev: OwnerFormState,
  form: FormData,
): Promise<OwnerFormState> {
  const parsed = OwnerForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const text = (key: string) => String(form.get(key) ?? "");
    return {
      error: null,
      fields: fieldErrors(parsed.error),
      values: {
        company: text("company"),
        name: text("name"),
        email: text("email"),
      },
    };
  }
  return createOwner(prev, form);
}

export function SignUpForm() {
  const [state, action, busy] = useActionState(submit, START);
  return (
    <form action={action} noValidate data-testid="sign-up-form">
      <FieldGroup className="gap-4">
        <AuthField
          label="Company or studio"
          name="company"
          autoComplete="organization"
          defaultValue={state.values.company}
          error={state.fields.company}
        />
        <AuthField
          label="Your name"
          name="name"
          autoComplete="name"
          defaultValue={state.values.name}
          error={state.fields.name}
        />
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.values.email}
          error={state.fields.email}
        />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={state.fields.password}
        />
        <FieldError data-testid="sign-up-error">{state.error}</FieldError>
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

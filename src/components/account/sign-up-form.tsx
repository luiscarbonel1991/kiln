"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { createOwner } from "@/app/actions/account";
import { AuthField } from "@/components/account/auth-field";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { MIN_PASSWORD, OwnerForm } from "@/lib/account-forms";

type Values = z.input<typeof OwnerForm>;

export function SignUpForm() {
  const form = useForm<Values, unknown, z.output<typeof OwnerForm>>({
    resolver: zodResolver(OwnerForm),
    defaultValues: { company: "", name: "", email: "", password: "" },
  });
  const { isSubmitting, errors } = form.formState;

  // The server checks again; what it refuses lands on the same fields.
  const submit = form.handleSubmit(async (values) => {
    const refused = await createOwner(values);
    for (const [name, message] of Object.entries(refused.fields)) {
      form.setError(name as keyof Values, { message });
    }
    if (refused.error) form.setError("root", { message: refused.error });
  });

  return (
    <form onSubmit={submit} noValidate data-testid="sign-up-form">
      <FieldGroup className="gap-4">
        <AuthField
          control={form.control}
          name="company"
          label="Your studio's name"
          autoComplete="organization"
        />
        <AuthField
          control={form.control}
          name="name"
          label="Your name"
          autoComplete="name"
        />
        <AuthField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
        />
        <AuthField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        {errors.root ? (
          <FieldError data-testid="sign-up-error" errors={[errors.root]} />
        ) : null}
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          data-testid="sign-up-submit"
          className="h-10 w-full rounded-field shadow-button"
        >
          {isSubmitting ? "Opening…" : "Open my studio"}
        </Button>
      </FieldGroup>
    </form>
  );
}

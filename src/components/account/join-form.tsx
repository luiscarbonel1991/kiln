"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { joinAsNewAccount } from "@/app/actions/join";
import { AuthField } from "@/components/account/auth-field";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { JoinForm as JoinFields, MIN_PASSWORD } from "@/lib/account-forms";

type Values = z.input<typeof JoinFields>;

// The join page's form for someone new: their name and a password; the email
// is the invitation's.
export function JoinForm({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const form = useForm<Values, unknown, z.output<typeof JoinFields>>({
    resolver: zodResolver(JoinFields),
    defaultValues: { name: "", password: "" },
  });
  const { isSubmitting, errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const refused = await joinAsNewAccount(invitationId, values);
    for (const [name, message] of Object.entries(refused.fields)) {
      form.setError(name as keyof Values, { message });
    }
    if (refused.error) form.setError("root", { message: refused.error });
  });

  return (
    <form onSubmit={submit} noValidate data-testid="join-form">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="join-email">Email</FieldLabel>
          <Input
            id="join-email"
            value={email}
            readOnly
            disabled
            className="h-10 rounded-field bg-background px-3"
          />
        </Field>
        <AuthField
          control={form.control}
          name="name"
          label="Your name"
          autoComplete="name"
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
          <FieldError data-testid="join-error" errors={[errors.root]} />
        ) : null}
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          data-testid="join-submit"
          className="h-10 w-full rounded-field shadow-button"
        >
          {isSubmitting ? "Joining…" : "Join the studio"}
        </Button>
      </FieldGroup>
    </form>
  );
}

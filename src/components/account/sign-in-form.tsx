"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { AuthField } from "@/components/account/auth-field";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { SignInForm as SignInFields } from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";

type Values = z.input<typeof SignInFields>;

export function SignInForm({
  notice,
  next = "/projects",
}: {
  notice?: string;
  next?: string;
}) {
  const router = useRouter();
  const form = useForm<Values, unknown, z.output<typeof SignInFields>>({
    resolver: zodResolver(SignInFields),
    defaultValues: { email: "", password: "" },
  });
  const { isSubmitting, errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const { error } = await authClient.signIn.email(values);
    if (error) {
      form.setError("root", {
        message:
          error.status === 429
            ? "Too many tries. Wait a moment, then try again."
            : "That email and password do not match an account here.",
      });
      return;
    }
    router.replace(next);
    router.refresh();
  });

  return (
    <form onSubmit={submit} noValidate data-testid="sign-in-form">
      <FieldGroup className="gap-4">
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
          autoComplete="current-password"
        />
        {errors.root ? (
          <FieldError data-testid="sign-in-error" errors={[errors.root]} />
        ) : notice ? (
          <FieldError data-testid="sign-in-notice">{notice}</FieldError>
        ) : null}
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          data-testid="sign-in-submit"
          className="h-10 w-full rounded-field shadow-button"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}

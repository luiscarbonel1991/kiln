import type { ComponentProps } from "react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// One labelled input of an account form, with its problem under it.
export function AuthField({
  label,
  hint,
  error,
  name,
  ...input
}: {
  label: string;
  hint?: string;
  error?: string;
  name: string;
} & ComponentProps<typeof Input>) {
  const id = `account-${name}`;
  const note = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        data-testid={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={note}
        className="h-10 rounded-field bg-background px-3"
        {...input}
      />
      {error ? (
        <FieldError id={note} data-testid={`${id}-error`}>
          {error}
        </FieldError>
      ) : hint ? (
        <FieldDescription id={note}>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}

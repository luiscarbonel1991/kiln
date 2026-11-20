"use client";

import type { ComponentProps } from "react";
import {
  type Control,
  Controller,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// One labelled input of an account form, bound to the form's state: its
// problem shows under it after a submit and goes as soon as the value is
// right again.
export function AuthField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  ...input
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  hint?: string;
} & Omit<ComponentProps<typeof Input>, "name">) {
  const id = `account-${name}`;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...input}
            {...field}
            id={id}
            data-testid={id}
            aria-invalid={fieldState.invalid}
            className="h-10 rounded-field bg-background px-3"
          />
          {fieldState.invalid ? (
            <FieldError
              data-testid={`${id}-error`}
              errors={[fieldState.error]}
            />
          ) : hint ? (
            <FieldDescription>{hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );
}

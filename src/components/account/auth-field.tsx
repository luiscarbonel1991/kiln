import type { ComponentProps } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// One labelled input of an account form.
export function AuthField({
  label,
  hint,
  name,
  ...input
}: { label: string; hint?: string; name: string } & ComponentProps<
  typeof Input
>) {
  const id = `account-${name}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        data-testid={id}
        className="h-10 rounded-field bg-background px-3"
        {...input}
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

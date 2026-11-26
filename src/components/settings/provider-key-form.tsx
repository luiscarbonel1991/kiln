"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  Controller,
  type ControllerFieldState,
  type RefCallBack,
  useForm,
  useWatch,
} from "react-hook-form";
import type { z } from "zod";
import {
  addProviderKeyAction,
  editProviderKeyAction,
  replaceProviderKeyAction,
} from "@/app/actions/settings";
import { PersonMark } from "@/components/settings/person-mark";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ProviderId } from "@/domain/model-defaults";
import {
  AddKeyForm,
  EditKeyForm,
  type KeyAnswer,
  ReplaceKeyForm,
} from "@/lib/provider-key-forms";
import { article } from "@/lib/provider-key-words";
import type { TeamMemberView } from "@/server/team";

// One of the provider's keys, as the form needs it: to say whether the team
// has one and who would move from another key.
export interface KeyChoice {
  id: string;
  name: string;
  forTeam: boolean;
  people: { memberId: string }[];
}

const WHERE: Record<ProviderId, { href: string; site: string }> = {
  openai: {
    href: "https://platform.openai.com/api-keys",
    site: "platform.openai.com",
  },
  google: {
    href: "https://aistudio.google.com/apikey",
    site: "aistudio.google.com",
  },
};

const FIELD = "h-10 rounded-field bg-card px-3";

interface Common {
  provider: ProviderId;
  label: string;
  // The provider's keys in the studio.
  keys: KeyChoice[];
  team: TeamMemberView[];
  onSaved: (answer: KeyAnswer) => void;
  onCancel: () => void;
}

// What a Controller hands its input, whichever form it is in: the add and
// the edit form share the name, who uses the key and the people.
type FieldProps<V> = {
  name: string;
  value: V;
  onChange: (...event: unknown[]) => void;
  onBlur: () => void;
  ref: RefCallBack;
  disabled?: boolean;
};

function NameField({
  provider,
  field,
  fieldState,
}: {
  provider: ProviderId;
  field: FieldProps<string>;
  fieldState: ControllerFieldState;
}) {
  const id = `${provider}-key-name`;
  return (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={id}>Name</FieldLabel>
      <Input
        {...field}
        id={id}
        data-testid={id}
        autoComplete="off"
        placeholder="Like Team key, or Bob's key"
        aria-invalid={fieldState.invalid}
        className={FIELD}
      />
      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
    </Field>
  );
}

// The whole team, or people chosen; with the team's place taken by another
// key, that choice is shown but cannot be picked.
function WhoField({
  provider,
  teamKey,
  field,
  fieldState,
}: {
  provider: ProviderId;
  teamKey: KeyChoice | undefined;
  field: FieldProps<"team" | "people">;
  fieldState: ControllerFieldState;
}) {
  const id = `${provider}-key-who`;
  return (
    <FieldSet data-invalid={fieldState.invalid}>
      <FieldLegend variant="label">Who uses it</FieldLegend>
      <RadioGroup
        name={field.name}
        value={field.value}
        onValueChange={field.onChange}
        aria-invalid={fieldState.invalid}
        data-testid={id}
      >
        <FieldLabel htmlFor={`${id}-team`}>
          <Field
            orientation="horizontal"
            data-disabled={teamKey ? true : undefined}
          >
            <RadioGroupItem
              value="team"
              id={`${id}-team`}
              data-testid={`${id}-team`}
              disabled={teamKey !== undefined}
              className="disabled:border-border disabled:bg-secondary disabled:opacity-100"
            />
            <FieldContent>
              {/* Greyed but legible: why it cannot be picked is read under it. */}
              <FieldTitle className="group-data-[disabled=true]/field:text-on-surface-mid group-data-[disabled=true]/field:opacity-100">
                The whole team
              </FieldTitle>
              {teamKey ? (
                <FieldDescription>
                  The team has one already: {teamKey.name}. Replace that one
                  instead.
                </FieldDescription>
              ) : null}
            </FieldContent>
          </Field>
        </FieldLabel>
        <FieldLabel htmlFor={`${id}-people`}>
          <Field orientation="horizontal">
            <RadioGroupItem
              value="people"
              id={`${id}-people`}
              data-testid={`${id}-people`}
            />
            <FieldContent>
              <FieldTitle>People you choose</FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>
      </RadioGroup>
      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
    </FieldSet>
  );
}

// A checkbox per person on the team, shown as a person. One already on
// another key of the provider is told they would move to this one.
function PeopleField({
  provider,
  keyId,
  keys,
  team,
  field,
  fieldState,
}: {
  provider: ProviderId;
  // The key being changed, whose own people are not "on another key".
  keyId: string | null;
  keys: KeyChoice[];
  team: TeamMemberView[];
  field: FieldProps<string[]>;
  fieldState: ControllerFieldState;
}) {
  return (
    <FieldSet data-invalid={fieldState.invalid}>
      <FieldLegend variant="label" className="sr-only">
        The people who use it
      </FieldLegend>
      <FieldGroup data-slot="checkbox-group">
        {team.map((person) => {
          const id = `${provider}-key-person-${person.id}`;
          const chosen = field.value.includes(person.id);
          const elsewhere = keys.find(
            (k) =>
              k.id !== keyId && k.people.some((p) => p.memberId === person.id),
          );
          return (
            <Field
              key={person.id}
              orientation="horizontal"
              data-invalid={fieldState.invalid}
            >
              <Checkbox
                id={id}
                name={field.name}
                data-testid={id}
                checked={chosen}
                aria-invalid={fieldState.invalid}
                onCheckedChange={(checked) =>
                  field.onChange(
                    checked === true
                      ? [...field.value, person.id]
                      : field.value.filter((m) => m !== person.id),
                  )
                }
              />
              <FieldLabel htmlFor={id} className="items-center font-normal">
                <PersonMark name={person.name} small />
                <span className="flex min-w-0 flex-col">
                  <span className="text-foreground">
                    {person.name}
                    {person.you ? (
                      <span className="text-on-surface-mid"> · you</span>
                    ) : null}
                  </span>
                  <span className="text-[0.75rem] text-on-surface-mid [overflow-wrap:anywhere]">
                    {person.email}
                  </span>
                  {elsewhere ? (
                    <span className="text-[0.75rem] text-on-surface-mid">
                      Now on {elsewhere.name}
                      {chosen ? ": moves to this one." : "."}
                    </span>
                  ) : null}
                </span>
              </FieldLabel>
            </Field>
          );
        })}
      </FieldGroup>
      <FieldDescription>
        Someone invited gets a key once they join.
      </FieldDescription>
      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
    </FieldSet>
  );
}

function KeyField({
  provider,
  label,
  field,
  fieldState,
}: {
  provider: ProviderId;
  label: string;
  field: FieldProps<string>;
  fieldState: ControllerFieldState;
}) {
  const id = `${provider}-key-secret`;
  const where = WHERE[provider];
  return (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...field}
        id={id}
        data-testid={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={fieldState.invalid}
        className={`${FIELD} font-mono`}
      />
      <FieldDescription>
        Make one at{" "}
        <a
          href={where.href}
          target="_blank"
          rel="noreferrer"
          data-testid={`${provider}-key-where`}
          className="underline underline-offset-2"
        >
          {where.site}
        </a>
        . Kiln keeps it sealed and never shows it again.
      </FieldDescription>
      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
    </Field>
  );
}

// The form's frame, its title and its two buttons, inside the provider's card.
function KeyFormFrame({
  provider,
  title,
  submit,
  pending,
  root,
  onSubmit,
  onCancel,
  children,
}: {
  provider: ProviderId;
  title: string;
  submit: string;
  pending: boolean;
  root: string | undefined;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-render border border-border-soft bg-card p-3"
      data-testid={`${provider}-key-form`}
    >
      <p className="font-sans text-[0.875rem] font-semibold text-foreground">
        {title}
      </p>
      {children}
      {root ? (
        <FieldError
          data-testid={`${provider}-key-error`}
          errors={[{ message: root }]}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          data-testid={`${provider}-key-submit`}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {submit}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid={`${provider}-key-cancel`}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

type AddValues = z.input<typeof AddKeyForm>;

// A new key: its name, who uses it, the key; sealed, then checked for free.
export function AddKeyFormView({
  provider,
  label,
  keys,
  team,
  onSaved,
  onCancel,
}: Common) {
  const form = useForm<AddValues, unknown, z.output<typeof AddKeyForm>>({
    resolver: zodResolver(AddKeyForm),
    defaultValues: {
      provider,
      name: "",
      who: keys.some((k) => k.forTeam) ? "people" : "team",
      memberIds: [],
      key: "",
    },
  });
  const { isSubmitting, errors } = form.formState;
  const who = useWatch({ control: form.control, name: "who" });
  const teamKey = keys.find((k) => k.forTeam);
  const submit = form.handleSubmit(async (values) => {
    const answer = await addProviderKeyAction(values);
    // Written, even when its free check after fails: the row says the rest.
    if (answer.saved) return onSaved(answer);
    form.setError(answer.field ?? "root", { message: answer.message });
  });
  return (
    <KeyFormFrame
      provider={provider}
      title={`Add ${article(label)} ${label} key`}
      submit="Add the key"
      pending={isSubmitting}
      root={errors.root?.message}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Controller
        name="name"
        control={form.control}
        render={(props) => <NameField provider={provider} {...props} />}
      />
      <Controller
        name="who"
        control={form.control}
        render={(props) => (
          <WhoField provider={provider} teamKey={teamKey} {...props} />
        )}
      />
      {who === "people" ? (
        <Controller
          name="memberIds"
          control={form.control}
          render={(props) => (
            <PeopleField
              provider={provider}
              keyId={null}
              keys={keys}
              team={team}
              {...props}
            />
          )}
        />
      ) : null}
      <Controller
        name="key"
        control={form.control}
        render={(props) => (
          <KeyField provider={provider} label="Key" {...props} />
        )}
      />
    </KeyFormFrame>
  );
}

type EditValues = z.input<typeof EditKeyForm>;

// A key's name and who uses it; the key itself is not shown or asked for.
export function EditKeyFormView({
  target,
  provider,
  keys,
  team,
  onSaved,
  onCancel,
}: Common & { target: KeyChoice }) {
  const form = useForm<EditValues, unknown, z.output<typeof EditKeyForm>>({
    resolver: zodResolver(EditKeyForm),
    defaultValues: {
      keyId: target.id,
      name: target.name,
      who: target.forTeam ? "team" : "people",
      memberIds: target.people.map((p) => p.memberId),
    },
  });
  const { isSubmitting, errors } = form.formState;
  const who = useWatch({ control: form.control, name: "who" });
  const teamKey = keys.find((k) => k.forTeam && k.id !== target.id);
  const submit = form.handleSubmit(async (values) => {
    const answer = await editProviderKeyAction(values);
    if (answer.saved) return onSaved(answer);
    const field =
      answer.field === "name" || answer.field === "memberIds"
        ? answer.field
        : "root";
    form.setError(field, { message: answer.message });
  });
  return (
    <KeyFormFrame
      provider={provider}
      title={`Change ${target.name}`}
      submit="Save"
      pending={isSubmitting}
      root={errors.root?.message}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Controller
        name="name"
        control={form.control}
        render={(props) => <NameField provider={provider} {...props} />}
      />
      <Controller
        name="who"
        control={form.control}
        render={(props) => (
          <WhoField provider={provider} teamKey={teamKey} {...props} />
        )}
      />
      {who === "people" ? (
        <Controller
          name="memberIds"
          control={form.control}
          render={(props) => (
            <PeopleField
              provider={provider}
              keyId={target.id}
              keys={keys}
              team={team}
              {...props}
            />
          )}
        />
      ) : null}
    </KeyFormFrame>
  );
}

type ReplaceValues = z.input<typeof ReplaceKeyForm>;

// A new secret on the same key: its name and people stay.
export function ReplaceKeyFormView({
  target,
  provider,
  onSaved,
  onCancel,
}: Pick<Common, "provider" | "onSaved" | "onCancel"> & {
  target: KeyChoice;
}) {
  const form = useForm<ReplaceValues, unknown, z.output<typeof ReplaceKeyForm>>(
    {
      resolver: zodResolver(ReplaceKeyForm),
      defaultValues: { keyId: target.id, key: "" },
    },
  );
  const { isSubmitting, errors } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    const answer = await replaceProviderKeyAction(values);
    if (answer.saved) return onSaved(answer);
    form.setError(answer.field === "key" ? "key" : "root", {
      message: answer.message,
    });
  });
  return (
    <KeyFormFrame
      provider={provider}
      title={`Replace ${target.name}`}
      submit="Replace the key"
      pending={isSubmitting}
      root={errors.root?.message}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Controller
        name="key"
        control={form.control}
        render={(props) => (
          <KeyField
            provider={provider}
            label={`The new key for ${target.name}`}
            {...props}
          />
        )}
      />
    </KeyFormFrame>
  );
}

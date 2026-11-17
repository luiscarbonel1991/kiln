"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import {
  cancelInvitationAction,
  inviteMemberAction,
  removeMemberAction,
} from "@/app/actions/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InviteForm } from "@/lib/account-forms";
import type { InvitationView, TeamView } from "@/server/team";

type Values = z.input<typeof InviteForm>;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const fullLink = (path: string) =>
  typeof window === "undefined" ? path : `${window.location.origin}${path}`;

function CopyLink({ invitation }: { invitation: InvitationView }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code
        className="min-w-0 flex-1 truncate rounded-field bg-secondary px-3 py-1.5 font-mono text-[0.7rem] text-foreground"
        data-testid="invitation-link"
      >
        {fullLink(invitation.path)}
      </code>
      <Button
        data-testid="invitation-copy"
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(fullLink(invitation.path));
          setCopied(true);
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

// Settings → Team, the owner's: invite someone by email (Kiln sends no mail:
// the owner copies the link and passes it on), see who is on the team, take
// someone off it, cancel an invitation nobody used.
export function Team({ team }: { team: TeamView }) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values, unknown, z.output<typeof InviteForm>>({
    resolver: zodResolver(InviteForm),
    defaultValues: { email: "" },
  });
  const { isSubmitting, errors } = form.formState;

  const invite = form.handleSubmit(async (values) => {
    setError(null);
    const result = await inviteMemberAction(values);
    if ("error" in result) {
      form.setError("root", { message: result.error });
      return;
    }
    form.reset();
  });

  const run = (work: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const result = await work();
      setConfirming(null);
      setError(result.error ?? null);
    });

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={invite}
        noValidate
        className="flex flex-col gap-2"
        data-testid="invite-form"
      >
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="invite-email">Invite by email</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  {...field}
                  id="invite-email"
                  data-testid="invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder="name@studio.com"
                  aria-invalid={fieldState.invalid}
                  className="h-9 rounded-field bg-background px-3"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  data-testid="invite-submit"
                  className="h-9"
                >
                  {isSubmitting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <UserPlus />
                  )}
                  Make an invitation
                </Button>
              </div>
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : null}
            </Field>
          )}
        />
        {errors.root ? (
          <FieldError data-testid="invite-error" errors={[errors.root]} />
        ) : null}
      </form>

      {team.invitations.length > 0 ? (
        <div className="flex flex-col gap-3" data-testid="invitations">
          <h3 className="font-sans text-[0.8rem] font-semibold text-foreground">
            Waiting to join
          </h3>
          {team.invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="flex flex-col gap-2 rounded-render border border-border-soft p-3"
            >
              <div className="flex items-center justify-between gap-2 font-sans text-[0.8rem]">
                <span className="truncate text-foreground">
                  {invitation.email}
                </span>
                <span className="shrink-0 font-mono text-[0.65rem] text-on-surface-mid">
                  until {day(invitation.expiresAt)}
                </span>
              </div>
              <CopyLink invitation={invitation} />
              <Button
                data-testid="invitation-cancel"
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                className="self-start"
                onClick={() => run(() => cancelInvitationAction(invitation.id))}
              >
                Cancel the invitation
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <ul
        className="flex flex-col divide-y divide-border-soft"
        data-testid="members"
      >
        {team.members.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 font-sans text-[0.8rem]"
          >
            <span className="font-semibold text-foreground">
              {member.name}
              {member.you ? " (you)" : ""}
            </span>
            <span className="min-w-0 truncate text-on-surface-mid">
              {member.email}
            </span>
            <Badge variant={member.role === "owner" ? "default" : "secondary"}>
              {member.role}
            </Badge>
            <span className="ml-auto font-mono text-[0.65rem] text-on-surface-mid">
              since {day(member.joinedAt)}
            </span>
            {member.role === "member" ? (
              confirming === member.id ? (
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    data-testid="member-remove-confirm"
                    onClick={() => run(() => removeMemberAction(member.id))}
                  >
                    Remove {member.name}
                  </Button>
                  <Button
                    data-testid="member-remove-keep"
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(null)}
                  >
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid="member-remove"
                  onClick={() => setConfirming(member.id)}
                >
                  Remove
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="font-mono text-[0.65rem] text-fail">{error}</p>
      ) : null}
    </div>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Loader2, Send, UserPlus } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import {
  cancelInvitationAction,
  inviteMemberAction,
  removeMemberAction,
} from "@/app/actions/team";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InviteForm } from "@/lib/account-forms";
import { cn } from "@/lib/utils";
import type { InvitationView, TeamMemberView, TeamView } from "@/server/team";

type Values = z.input<typeof InviteForm>;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const fullLink = (path: string) =>
  typeof window === "undefined" ? path : `${window.location.origin}${path}`;

// A person's mark: their initials on one of the provenance colours, the same
// colour every time for the same name.
const MARKS = [
  "bg-prov-local/15 text-prov-local",
  "bg-prov-image/15 text-prov-image",
  "bg-prov-recipe/15 text-prov-recipe",
  "bg-prov-brand/15 text-prov-brand",
];

function Mark({ name, faded }: { name: string; faded?: boolean }) {
  // An invitation has only an email: its first letter.
  const words = name.includes("@")
    ? [name]
    : name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  const tone =
    MARKS[
      [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % MARKS.length
    ];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full font-serif text-[0.95rem]",
        faded
          ? "border border-dashed border-border bg-transparent text-on-surface-mid"
          : tone,
      )}
      style={{ fontVariationSettings: "'opsz' 40" }}
    >
      {initials}
    </span>
  );
}

// Send the link the way the phone sends anything (a chat, a message, mail);
// where the browser cannot share, copy it.
function SendLink({
  invitation,
  studio,
}: {
  invitation: InvitationView;
  studio: string;
}) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  const url = fullLink(invitation.path);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only" data-testid="invitation-link">
        {url}
      </span>
      {canShare ? (
        <Button
          type="button"
          size="sm"
          data-testid="invitation-share"
          onClick={() =>
            navigator
              .share({
                title: `Join ${studio} on Kiln`,
                text: `Join ${studio} on Kiln: make your account here (the link lasts 7 days).`,
                url,
              })
              .catch(() => undefined)
          }
        >
          <Send /> Send the invitation
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant={canShare ? "ghost" : "default"}
        data-testid="invitation-copy"
        onClick={copy}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy the link"}
      </Button>
    </div>
  );
}

function Person({
  member,
  pending,
  confirming,
  onConfirm,
  onKeep,
  onRemove,
}: {
  member: TeamMemberView;
  pending: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onKeep: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <Mark name={member.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-sans text-[0.9rem] font-semibold text-foreground">
            {member.name}
            {member.you ? (
              <span className="font-normal text-on-surface-mid"> · you</span>
            ) : null}
          </span>
          <span className="truncate font-sans text-[0.78rem] text-on-surface-mid">
            {member.email}
          </span>
        </div>
        {member.role === "owner" ? (
          <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-primary">
            Owner
          </span>
        ) : confirming ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="member-remove"
            className="shrink-0 text-on-surface-mid"
            onClick={onConfirm}
          >
            Remove
          </Button>
        )}
      </div>
      {confirming ? (
        <div className="ml-13 flex flex-col gap-2 rounded-render bg-secondary p-3">
          <p className="font-sans text-[0.78rem] leading-snug text-foreground">
            {member.name} stops seeing the studio&apos;s work at once. What they
            made stays.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              data-testid="member-remove-confirm"
              onClick={onRemove}
            >
              Remove {member.name}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="member-remove-keep"
              onClick={onKeep}
            >
              Keep
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

// Settings → Team, the owner's: invite someone by email and send them the
// link (Kiln sends no mail), see who is on the team, take someone off it,
// cancel an invitation nobody used.
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
    <div className="flex flex-col gap-6">
      <ul
        className="flex flex-col divide-y divide-border-soft"
        data-testid="members"
      >
        {team.members.map((member) => (
          <Person
            key={member.id}
            member={member}
            pending={pending}
            confirming={confirming === member.id}
            onConfirm={() => setConfirming(member.id)}
            onKeep={() => setConfirming(null)}
            onRemove={() => run(() => removeMemberAction(member.id))}
          />
        ))}
        {team.invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-col gap-3 py-3"
            data-testid="invitation"
          >
            <div className="flex items-center gap-3">
              <Mark name={invitation.email} faded />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-sans text-[0.9rem] text-foreground">
                  {invitation.email}
                </span>
                <span className="font-sans text-[0.78rem] text-on-surface-mid">
                  Invited · the link works until {day(invitation.expiresAt)}
                </span>
              </div>
            </div>
            <div className="ml-13 flex flex-wrap items-center gap-2">
              <SendLink invitation={invitation} studio={team.studio} />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                data-testid="invitation-cancel"
                className="text-on-surface-mid"
                onClick={() => run(() => cancelInvitationAction(invitation.id))}
              >
                Cancel
              </Button>
            </div>
          </li>
        ))}
      </ul>

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
              <FieldLabel htmlFor="invite-email">
                Invite someone who works with you
              </FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  {...field}
                  id="invite-email"
                  data-testid="invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="Their email"
                  aria-invalid={fieldState.invalid}
                  className="h-10 rounded-field bg-background px-3"
                />
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  data-testid="invite-submit"
                  className="h-10 rounded-field"
                >
                  {isSubmitting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <UserPlus />
                  )}
                  Invite
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
      {error ? (
        <p className="font-mono text-[0.65rem] text-fail">{error}</p>
      ) : null}
    </div>
  );
}

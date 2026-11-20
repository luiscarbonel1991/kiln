"use client";

import { useState, useTransition } from "react";
import { joinSignedIn } from "@/app/actions/join";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

// The join page for someone already signed in with the invited email.
export function JoinButton({
  invitationId,
  studio,
}: {
  invitationId: string;
  studio: string;
}) {
  const [refused, setRefused] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        disabled={pending}
        data-testid="join-signed-in"
        className="h-10 w-full rounded-field shadow-button"
        onClick={() =>
          startTransition(async () =>
            setRefused(await joinSignedIn(invitationId)),
          )
        }
      >
        {pending ? "Joining…" : `Join ${studio}`}
      </Button>
      {refused ? (
        <FieldError data-testid="join-error">{refused}</FieldError>
      ) : null}
    </div>
  );
}

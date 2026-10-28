"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { leaveOutListingAction } from "@/app/actions/shops";
import { Button } from "@/components/ui/button";

// Leave a listing out of the best sellers (an add-on, a sample: not a
// product to refresh), or put it back.
export function LeaveOut({
  listingId,
  title,
  out,
}: {
  listingId: string;
  title: string;
  out: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = () =>
    startTransition(async () => {
      const result = await leaveOutListingAction({ listingId, out: !out });
      setError(result.error ?? null);
    });
  return (
    <span className="inline-flex items-center gap-1">
      {out ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={toggle}
          aria-label={`Put ${title} back in the ranking`}
          data-testid={`put-back-${listingId}`}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Eye />}
          Put back
        </Button>
      ) : (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={pending}
          onClick={toggle}
          title="Not a product: leave it out of the ranking"
          aria-label={`Leave ${title} out of the ranking`}
          data-testid={`leave-out-${listingId}`}
          className="text-on-surface-dim hover:text-foreground"
        >
          {pending ? <Loader2 className="animate-spin" /> : <EyeOff />}
        </Button>
      )}
      {error ? (
        <span className="font-mono text-[0.6rem] text-prov-local" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

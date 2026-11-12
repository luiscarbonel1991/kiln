"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { updateProjectProductAction } from "@/app/actions/board";
import { Button } from "@/components/ui/button";

// Brings the project up to its product's current version (free: no model
// call). The same button sits on the board's banner and in the generate
// confirmation.
export function UpdateProjectButton({
  projectId,
  onUpdated,
  size = "sm",
}: {
  projectId: string;
  onUpdated?: () => void;
  size?: "sm" | "xs";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size={size}
        className="self-start font-semibold shadow-button"
        data-testid="project-update"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await updateProjectProductAction({ projectId });
            if (result?.error) setError(result.error);
            else onUpdated?.();
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        Update the project · free
      </Button>
      {error ? (
        <p className="font-mono text-[0.68rem] text-fail">{error}</p>
      ) : null}
    </div>
  );
}

// "This product changed since this project started": what changed, that new
// scenes would still show the earlier version, and the update — never a
// silent re-run of an old prompt.
export function ProductChangedBanner({
  projectId,
  changed,
  ownPrompts,
  planChanges = [],
}: {
  projectId: string;
  changed: string[];
  ownPrompts: string[];
  // What the update does to the plan, a line per destination.
  planChanges?: string[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card bg-prov-brand/10 p-5">
      <div className="flex flex-col gap-1">
        <p className="font-sans text-sm font-semibold text-foreground">
          This product changed since this project started
          {changed.length > 0 ? `: ${changed.join(", ")}.` : "."}
        </p>
        <p className="font-sans text-[0.8rem] leading-snug text-on-surface-mid">
          Scenes made from now on would still show the earlier version. Your own
          card edits are kept; approved scenes stay approved, marked "earlier
          version".
        </p>
        {ownPrompts.length > 0 ? (
          <p className="font-sans text-[0.75rem] leading-snug text-prov-brand">
            {ownPrompts.join(", ")}{" "}
            {ownPrompts.length === 1 ? "runs its" : "run their"} own prompt from
            the editor and will not follow the product.
          </p>
        ) : null}
        {planChanges.map((line) => (
          <p
            key={line}
            className="font-sans text-[0.8rem] leading-snug text-foreground"
          >
            {line}
          </p>
        ))}
      </div>
      <UpdateProjectButton projectId={projectId} />
    </div>
  );
}

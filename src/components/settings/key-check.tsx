"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { checkProviderKeyAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import type { ProviderId } from "@/domain/model-defaults";

// Settings → Providers: check a key now, for free (the provider lists its
// models; nothing is generated), e.g. right after replacing it in .env.
export function KeyCheck({
  provider,
  label,
}: {
  provider: ProviderId;
  label: string;
}) {
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        data-testid={`key-check-${provider}`}
        aria-label={`Check the ${label} key`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setSaid(await checkProviderKeyAction(provider));
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        Check the key
      </Button>
      <span
        className={`font-mono text-[0.65rem] [overflow-wrap:anywhere] ${
          said && !said.ok ? "text-prov-local" : "text-on-surface-dim"
        }`}
        data-testid={`key-check-${provider}-said`}
        aria-live="polite"
      >
        {said ? said.message : "Free: lists the models it reaches."}
      </span>
    </div>
  );
}

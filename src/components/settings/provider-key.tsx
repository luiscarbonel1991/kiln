"use client";

import { Loader2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import {
  removeProviderKeyAction,
  saveProviderKeyAction,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProviderId } from "@/domain/model-defaults";

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

// Settings → Providers: paste a provider's key and Kiln keeps it sealed. The
// key is never sent back: the card only names its last four characters. A
// saved key is checked for free at once, so the answer is the provider's.
export function ProviderKey({
  provider,
  label,
  saved,
}: {
  provider: ProviderId;
  label: string;
  saved: boolean;
}) {
  const id = useId();
  const [key, setKey] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const where = WHERE[provider];
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!key.trim()) return;
        startTransition(async () => {
          const answer = await saveProviderKeyAction({ provider, key });
          setSaid(answer);
          setKey("");
        });
      }}
    >
      <label
        htmlFor={id}
        className="font-sans text-[0.8rem] font-medium text-foreground"
      >
        {saved ? `Replace the ${label} key` : `Paste your ${label} key`}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="min-w-[10rem] flex-1 bg-card font-mono"
          data-testid={`provider-key-${provider}`}
          value={key}
          disabled={pending}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          disabled={pending || !key.trim()}
          data-testid={`provider-key-${provider}-save`}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            data-testid={`provider-key-${provider}-remove`}
            aria-label={`Remove the ${label} key`}
            onClick={() =>
              startTransition(async () => {
                setSaid(await removeProviderKeyAction(provider));
              })
            }
          >
            Remove
          </Button>
        ) : null}
      </div>
      <span
        className={`font-sans text-xs leading-snug [overflow-wrap:anywhere] ${
          said && !said.ok ? "text-fail" : "text-on-surface-mid"
        }`}
        data-testid={`provider-key-${provider}-said`}
        aria-live="polite"
      >
        {said ? (
          said.message
        ) : (
          <>
            Make one at{" "}
            <a
              href={where.href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {where.site}
            </a>
            . Kiln keeps it sealed and never shows it again.
          </>
        )}
      </span>
    </form>
  );
}

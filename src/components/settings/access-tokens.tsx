"use client";

import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import {
  createAccessTokenAction,
  revokeAccessTokenAction,
} from "@/app/actions/access-tokens";
import { Button } from "@/components/ui/button";
import type { AccessTokenView } from "@/server/access-tokens";

const FIELD =
  "h-8 w-full min-w-0 rounded-field border border-border bg-secondary px-3 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Settings → Access tokens: make one per script or system that feeds Kiln,
// copy it once, revoke it when that system stops using it.
export function AccessTokens({ tokens }: { tokens: AccessTokenView[] }) {
  const [name, setName] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await createAccessTokenAction(name);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setMade(result.token);
      setCopied(false);
      setName("");
    });

  const revoke = (id: string) =>
    startTransition(async () => {
      const result = await revokeAccessTokenAction(id);
      setConfirming(null);
      setError(result.error ?? null);
    });

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label className="sr-only" htmlFor="token-name">
          Token name
        </label>
        <input
          id="token-name"
          data-testid="token-name"
          className={FIELD}
          placeholder="What will use it, e.g. Catalog exporter"
          value={name}
          maxLength={60}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          data-testid="token-create"
          disabled={pending || !name.trim()}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Make a token
        </Button>
      </form>

      {error ? (
        <p className="font-mono text-[0.65rem] text-prov-local">{error}</p>
      ) : null}

      {made ? (
        <div
          className="flex flex-col gap-2 rounded-render border border-prov-recipe/40 bg-surface-soft p-4"
          data-testid="token-made"
        >
          <div className="font-sans text-[0.8rem] font-semibold text-foreground">
            Copy it now: Kiln keeps only a fingerprint and cannot show it again.
          </div>
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 break-all rounded-field bg-card px-3 py-2 font-mono text-[0.75rem] text-foreground"
              data-testid="token-value"
            >
              {made}
            </code>
            <Button
              variant="outline"
              size="sm"
              data-testid="token-copy"
              onClick={async () => {
                await navigator.clipboard.writeText(made);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="token-done"
              onClick={() => setMade(null)}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {tokens.length === 0 ? (
        <p className="font-sans text-[0.8rem] text-on-surface-mid">
          No tokens yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-soft py-3 last:border-b-0"
            >
              <KeyRound className="size-3.5 text-on-surface-dim" />
              <div className="min-w-0 flex-1">
                <div className="font-sans text-sm font-semibold text-foreground">
                  {t.name}
                </div>
                <div className="font-sans text-[0.75rem] text-on-surface-mid">
                  <span className="font-mono text-[0.7rem]">{t.prefix}…</span>
                  {" · "}made {when(t.createdAt)}
                  {" · "}
                  {t.lastUsedAt
                    ? `last used ${when(t.lastUsedAt)}`
                    : "never used"}
                </div>
              </div>
              {confirming === t.id ? (
                <div className="flex items-center gap-2">
                  <span className="font-sans text-[0.75rem] text-foreground">
                    Calls with it will be refused.
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    data-testid={`token-revoke-confirm-${t.id}`}
                    disabled={pending}
                    onClick={() => revoke(t.id)}
                  >
                    Revoke
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`token-revoke-cancel-${t.id}`}
                    disabled={pending}
                    onClick={() => setConfirming(null)}
                  >
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revoke ${t.name}`}
                  data-testid={`token-revoke-${t.id}`}
                  disabled={pending}
                  onClick={() => setConfirming(t.id)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

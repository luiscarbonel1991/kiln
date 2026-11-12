"use client";

import { Loader2, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { disconnectShopAction } from "@/app/actions/shops";
import { Button } from "@/components/ui/button";

// Settings → Shops: forget the connected shop (Kiln drops its tokens), after
// a second click.
export function DisconnectShop({ shopName }: { shopName: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!asking) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        data-testid="shop-disconnect"
        onClick={() => setAsking(true)}
      >
        <Unplug /> Disconnect
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-render border border-border-soft bg-surface-soft p-3">
      <span className="font-sans text-[0.8rem] text-foreground">
        Disconnect {shopName}? Kiln forgets its access; your shop is not
        touched. To revoke Kiln on Etsy too, remove it from your Etsy
        account&apos;s apps.
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          data-testid="shop-disconnect-confirm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await disconnectShopAction();
              setError(result.error ?? null);
              setAsking(false);
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Disconnect
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="shop-disconnect-cancel"
          disabled={pending}
          onClick={() => setAsking(false)}
        >
          Keep it
        </Button>
      </div>
      {error ? (
        <span className="font-mono text-[0.65rem] text-fail">{error}</span>
      ) : null}
    </div>
  );
}

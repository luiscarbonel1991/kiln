"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// Sign out and stay on this page: an invitation opened while signed in as
// someone else is then read as the person it is for.
export function SwitchAccountButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="lg"
      disabled={pending}
      data-testid="switch-account"
      className="h-10 w-full rounded-field"
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.refresh();
        })
      }
    >
      {pending ? "Signing out…" : "Sign out and use this link"}
    </Button>
  );
}

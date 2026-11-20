"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      data-testid="sign-out"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
      className="inline-flex size-7 items-center justify-center rounded-field text-on-surface-mid transition-colors hover:text-foreground"
    >
      <LogOut className="size-3.5" />
    </button>
  );
}

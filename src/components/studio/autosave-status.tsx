"use client";

import { Check, Cloud, RefreshCw } from "lucide-react";
import type { PersistenceStatus } from "@/store/use-project-persistence";

const LABEL: Record<PersistenceStatus, string> = {
  idle: "Autosave on",
  restoring: "Restoring…",
  saving: "Saving…",
  saved: "Saved",
};

// Reusable autosave indicator for the header (Pillar C).
export function AutosaveStatus({ status }: { status: PersistenceStatus }) {
  const spinning = status === "saving" || status === "restoring";
  return (
    <span className="flex items-center gap-1.5 font-sans text-xs text-on-surface-mid">
      {spinning ? (
        <RefreshCw className="size-3 animate-spin" />
      ) : status === "saved" ? (
        <Check className="size-3 text-prov-recipe" />
      ) : (
        <Cloud className="size-3" />
      )}
      {LABEL[status]}
    </span>
  );
}

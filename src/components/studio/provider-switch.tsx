"use client";

import { ArrowLeftRight } from "lucide-react";
import type { ModelConfig } from "@/domain/model-config";

// Clickable "provider" row inside the assembled-prompt tray — toggles the card's
// image provider (google ↔ openai).
export function ProviderSwitch({
  provider,
  onSwitch,
}: {
  provider: ModelConfig["provider"];
  onSwitch: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSwitch}
      title="Switch provider"
      className="flex w-full items-center justify-between border-border-soft border-b py-1 font-mono text-[0.6875rem]"
    >
      <span className="text-on-surface-dim">provider</span>
      <span className="flex items-center gap-1 font-medium text-primary">
        {provider} <ArrowLeftRight className="size-3" />
      </span>
    </button>
  );
}

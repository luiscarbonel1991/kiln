"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { ModelParams } from "@/components/studio/model-params";
import { ProviderSwitch } from "@/components/studio/provider-switch";
import { canUse, PROVIDER_CAPABILITIES } from "@/domain/capabilities";
import type { ModelConfig } from "@/domain/model-config";
import { cn } from "@/lib/utils";

// Collapsible tray: the editable prompt (override of the assembled prompt) + the
// per-card provider switch (image cards only) + editable model params + an
// optional video meta row. Capability data comes from @/domain (no providers
// import on the client). Edits apply on the next Generate/Re-roll.
export function AssembledPromptTray({
  open,
  onToggle,
  prompt,
  promptOverride,
  model,
  onEditModel,
  onEditPrompt,
  onSwitchProvider,
  video,
}: {
  open: boolean;
  onToggle: () => void;
  prompt: string;
  promptOverride?: string;
  model: ModelConfig;
  onEditModel: (patch: Partial<ModelConfig>) => void;
  onEditPrompt: (value: string) => void;
  onSwitchProvider?: () => void;
  video?: { durationSec: number; motion: string };
}) {
  const canCompose = canUse(PROVIDER_CAPABILITIES[model.provider], "compose");
  return (
    <div className="border-border-soft border-t">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-4 py-3 font-sans text-xs font-medium text-on-surface-mid"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
        Assembled prompt and model
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-4 pb-3">
          <div className="flex flex-col gap-1">
            <textarea
              value={promptOverride ?? prompt}
              onChange={(e) => onEditPrompt(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full resize-y rounded-field bg-secondary px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            {promptOverride ? (
              <button
                type="button"
                onClick={() => onEditPrompt("")}
                className="flex items-center gap-1 self-end font-sans text-[0.625rem] text-on-surface-mid transition-colors hover:text-primary"
              >
                <RotateCcw className="size-2.5" /> reset to fields
              </button>
            ) : null}
          </div>
          {onSwitchProvider ? (
            <ProviderSwitch
              provider={model.provider}
              onSwitch={onSwitchProvider}
            />
          ) : null}
          <ModelParams model={model} onEdit={onEditModel} />
          {video ? (
            <div className="font-mono text-[0.6875rem]">
              <div className="flex justify-between border-border-soft border-b py-1">
                <span className="text-on-surface-dim">duration</span>
                <span className="font-medium text-foreground">
                  {video.durationSec}s
                </span>
              </div>
              <div className="flex justify-between border-border-soft border-b py-1">
                <span className="text-on-surface-dim">motion</span>
                <span className="font-medium text-foreground">
                  {video.motion}
                </span>
              </div>
            </div>
          ) : null}
          {canCompose ? null : (
            <p className="font-sans text-[0.6875rem] text-prov-brand">
              compose unavailable on this provider
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { ChevronDown, RotateCcw } from "lucide-react";
import { ModelChoice } from "@/components/models/model-choice";
import { ModelParams } from "@/components/studio/model-params";
import { canUse, PROVIDER_CAPABILITIES } from "@/domain/capabilities";
import type { ModelConfig } from "@/domain/model-config";
import { cn } from "@/lib/utils";

// Collapsible tray: the editable prompt (override of the assembled prompt) + the
// card's model (both providers, with prices) + editable model params + an
// optional video meta row. Capability data comes from @/domain (no providers
// import on the client). Edits apply on the next Generate/Re-roll.
export function AssembledPromptTray({
  open,
  onToggle,
  prompt,
  promptOverride,
  model,
  refs = 0,
  onEditModel,
  onEditPrompt,
  video,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  prompt: string;
  promptOverride?: string;
  model: ModelConfig;
  refs?: number;
  onEditModel: (patch: Partial<ModelConfig>) => void;
  onEditPrompt: (value: string) => void;
  video?: { durationSec: number; motion: string };
  testId: string;
}) {
  // Cards only ever `edit` (never `compose`), so the sole provider limit that can
  // actually break generation is maxRefs. Warn only when this card exceeds it —
  // otherwise stay quiet instead of showing an always-on, irrelevant note.
  const caps = PROVIDER_CAPABILITIES[model.provider];
  const tooManyRefs = !canUse(caps, "edit", refs);
  return (
    <div className="border-border-soft border-t">
      <button
        type="button"
        onClick={onToggle}
        data-testid={`${testId}-prompt-toggle`}
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
              aria-label="Assembled prompt"
              data-testid={`${testId}-prompt`}
              className="w-full resize-y rounded-field bg-secondary px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            {promptOverride ? (
              <button
                type="button"
                onClick={() => onEditPrompt("")}
                data-testid={`${testId}-prompt-reset`}
                className="flex items-center gap-1 self-end font-sans text-[0.625rem] text-on-surface-mid transition-colors hover:text-primary"
              >
                <RotateCcw className="size-2.5" /> reset to fields
              </button>
            ) : null}
          </div>
          <ModelChoice
            kind={video ? "video" : "image"}
            value={model}
            onChange={(next) => onEditModel(next)}
          />
          <ModelParams
            model={model}
            onEdit={onEditModel}
            testId={testId}
            video={Boolean(video)}
          />
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
          {tooManyRefs ? (
            <p className="font-sans text-[0.6875rem] text-prov-brand">
              {model.provider} accepts {caps.maxRefs} reference image
              {caps.maxRefs === 1 ? "" : "s"}; this card has {refs}. Remove some
              or switch providers.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

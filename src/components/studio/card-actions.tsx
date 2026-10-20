"use client";

import { Film, RefreshCw, Sparkles } from "lucide-react";
import type { Card } from "@/domain/card";
import { cn } from "@/lib/utils";

// The card action bar, driven by status so generation is explicit (cost control):
// - draft/error → a single Generate (or Retry) button; nothing hits the providers
//   until clicked.
// - rendering → a disabled "Generating…" state.
// - done → Re-roll | To video (image) / Re-roll full-width (video — already video).
// In a planned project (`busyLabel`, `generateHint`, `canPromote`,
// `disabledReason`) the bar reflects the queue: "Queued…" / "Retrying…" while a
// job is active, the estimated cost on Generate and Re-roll (each is a paid
// call), no "To video" (the queue makes images only), and a reason when the
// card cannot be queued.
export function CardActions({
  type,
  status,
  onGenerate,
  onReroll,
  onPromote,
  busyLabel = "Generating…",
  generateHint,
  canPromote = true,
  disabledReason,
}: {
  type: Card["type"];
  status: Card["status"];
  onGenerate: () => void;
  onReroll: () => void;
  onPromote: () => void;
  busyLabel?: string;
  generateHint?: string;
  canPromote?: boolean;
  disabledReason?: string;
}) {
  const isVideo = type === "video";

  if (disabledReason) {
    return (
      <div className="flex border-border-soft border-t">
        <span className="flex flex-1 items-center justify-center px-3 py-3 text-center font-sans text-[0.72rem] text-on-surface-dim">
          {disabledReason}
        </span>
      </div>
    );
  }

  if (status === "rendering") {
    return (
      <div className="flex border-border-soft border-t">
        <span className="flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-medium text-on-surface-dim">
          <RefreshCw className="size-3 animate-spin" /> {busyLabel}
        </span>
      </div>
    );
  }

  if (status === "draft" || status === "error") {
    return (
      <div className="flex border-border-soft border-t">
        <button
          type="button"
          onClick={onGenerate}
          className="flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-semibold text-primary transition-colors hover:bg-secondary"
        >
          <Sparkles className="size-3" />
          {status === "error"
            ? "Retry"
            : isVideo
              ? "Generate video"
              : "Generate"}
          {generateHint ? (
            <span className="font-mono text-[0.625rem] font-normal text-on-surface-mid">
              {generateHint}
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className="flex border-border-soft border-t">
      <button
        type="button"
        onClick={onReroll}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-medium text-on-surface-mid transition-colors hover:bg-secondary",
          !isVideo && canPromote && "border-border-soft border-r",
        )}
      >
        <RefreshCw className="size-3" /> Re-roll
        {generateHint ? (
          <span className="font-mono text-[0.625rem] font-normal text-on-surface-mid">
            {generateHint}
          </span>
        ) : null}
      </button>
      {isVideo || !canPromote ? null : (
        <button
          type="button"
          onClick={onPromote}
          className="flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-medium text-on-surface-mid transition-colors hover:bg-secondary"
        >
          <Film className="size-3" /> To video
        </button>
      )}
    </div>
  );
}

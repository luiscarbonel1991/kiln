"use client";

import { Film, RefreshCw, Sparkles } from "lucide-react";
import type { Card } from "@/domain/card";
import { cn } from "@/lib/utils";

// The card action bar, driven by status so generation is explicit (cost control):
// - draft/error → a single Generate (or Retry) button; nothing hits the providers
//   until clicked.
// - rendering → a disabled "Generating…" state.
// - done → Re-roll | To video (image) / Re-roll full-width (video — already video).
export function CardActions({
  type,
  status,
  onGenerate,
  onReroll,
  onPromote,
}: {
  type: Card["type"];
  status: Card["status"];
  onGenerate: () => void;
  onReroll: () => void;
  onPromote: () => void;
}) {
  const isVideo = type === "video";

  if (status === "rendering") {
    return (
      <div className="flex border-border-soft border-t">
        <span className="flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-medium text-on-surface-dim">
          <RefreshCw className="size-3 animate-spin" /> Generating…
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
          !isVideo && "border-border-soft border-r",
        )}
      >
        <RefreshCw className="size-3" /> Re-roll
      </button>
      {isVideo ? null : (
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

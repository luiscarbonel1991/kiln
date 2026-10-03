"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Phase, ProjectSummary } from "@/domain/persisted-project";
import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForSeed, hashSeed } from "@/lib/gradient";
import { formatRelativeTime } from "@/lib/relative-time";
import { displayName } from "@/lib/workspace-summary";

// Phase pill — copies ProvenanceBadge's class string for visual consistency, but
// keyed by phase (the provenance badge is keyed by Field.source).
const PHASE_BADGE: Record<Phase, { label: string; cls: string }> = {
  upload: { label: "Upload", cls: "text-on-surface-mid bg-on-surface-mid/10" },
  analysis: { label: "Analysis", cls: "text-prov-image bg-prov-image/10" },
  planning: { label: "Planning", cls: "text-prov-brand bg-prov-brand/10" },
  generation: {
    label: "Generation",
    cls: "text-prov-recipe bg-prov-recipe/10",
  },
};

export function WorkspaceCard({
  summary,
  onOpen,
  onDelete,
  onRename,
  disabled,
}: {
  summary: ProjectSummary;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [imgError, setImgError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = displayName(summary);
  const renderable = isRenderableUrl(summary.thumbnailUrl) && !imgError;
  const phase = PHASE_BADGE[summary.phase];

  // Focus + select the name when the inline editor opens, so typing replaces it.
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const saveRename = () => {
    const value = draft.trim();
    if (value) {
      onRename(value);
      setRenaming(false);
    }
  };

  return (
    <div className="group/card relative overflow-hidden rounded-card bg-card shadow-card transition-shadow hover:shadow-render">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="block w-full cursor-pointer text-left disabled:cursor-default"
      >
        <div className="p-3 pb-0">
          <div
            className="relative h-[150px] overflow-hidden rounded-render shadow-render"
            style={
              renderable
                ? undefined
                : { backgroundImage: gradientForSeed(hashSeed(name)) }
            }
          >
            {renderable && summary.thumbnailUrl ? (
              // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
              <img
                src={summary.thumbnailUrl}
                alt={name}
                className="size-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : null}
            <span
              className={`pointer-events-none absolute top-2.5 left-2.5 rounded-badge px-[7px] py-0.5 font-mono text-[0.59375rem] ${phase.cls}`}
            >
              {phase.label}
            </span>
          </div>
        </div>
        <div className="px-3.5 pt-3 pb-3.5">
          <p className="line-clamp-1 font-serif text-[1.0625rem] italic leading-tight text-foreground">
            {name}
          </p>
          <p className="pt-1 font-mono text-[0.625rem] text-on-surface-dim">
            {formatRelativeTime(summary.updatedAt)} · {summary.cardCount} card
            {summary.cardCount === 1 ? "" : "s"}
          </p>
        </div>
      </button>

      <div className="absolute top-2 right-2 z-20 flex gap-1 opacity-0 transition group-hover/card:opacity-100">
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setRenaming(true);
          }}
          aria-label="Rename workspace"
          className="flex size-7 items-center justify-center rounded-pill bg-card/90 text-on-surface-mid shadow-render transition hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete workspace"
          className="flex size-7 items-center justify-center rounded-pill bg-card/90 text-on-surface-mid shadow-render transition hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {renaming ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-card bg-card/95 p-4 backdrop-blur-sm">
          <input
            ref={inputRef}
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            aria-label="Workspace name"
            className="w-full rounded-field border border-border-soft bg-background px-3 py-1.5 font-sans text-sm text-foreground outline-none focus:border-primary"
          />
          <div className="flex gap-2 pt-1">
            <Button
              variant="default"
              size="sm"
              onClick={saveRename}
              disabled={disabled || draft.trim().length === 0}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-card bg-card/95 p-4 text-center backdrop-blur-sm">
          <p className="font-sans text-sm text-foreground">
            Delete this workspace?
          </p>
          <p className="font-mono text-[0.625rem] text-on-surface-dim">
            This can't be undone.
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={disabled}
            >
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

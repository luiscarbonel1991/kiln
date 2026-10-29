"use client";

import { Lock, Unlock } from "lucide-react";
import {
  PaletteSwatches,
  parseHexList,
} from "@/components/studio/palette-swatches";
import {
  PROV_TOKENS,
  ProvenanceBadge,
} from "@/components/studio/provenance-badge";
import type { Field } from "@/domain/field";
import { cn } from "@/lib/utils";

// One editable card field: a lock toggle (colored by provenance when locked),
// a micro-label, the value (palette → swatches; else a borderless input that
// disables when locked), and a provenance badge.
export function CardFieldRow({
  label,
  field,
  onEdit,
  onToggleLock,
  testId,
}: {
  label: string;
  field: Field;
  onEdit: (value: string) => void;
  onToggleLock: () => void;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-field px-2 py-1.5 transition-colors hover:bg-secondary">
      <button
        type="button"
        onClick={onToggleLock}
        title={field.locked ? "Locked" : "Unlocked"}
        aria-label={`Lock ${label}`}
        aria-pressed={field.locked}
        data-testid={`${testId}-lock`}
        className={cn(
          "flex flex-shrink-0",
          field.locked ? PROV_TOKENS[field.source].text : "text-on-surface-dim",
        )}
      >
        {field.locked ? (
          <Lock className="size-3.5" />
        ) : (
          <Unlock className="size-3.5" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
          {label}
        </div>
        {label === "Palette" ? (
          <div className="flex flex-col gap-1.5">
            <input
              value={field.value}
              disabled={field.locked}
              onChange={(e) => onEdit(e.target.value)}
              aria-label={label}
              data-testid={`${testId}-input`}
              className={cn(
                "w-full bg-transparent font-sans text-[0.8125rem] text-foreground outline-none focus:text-primary",
                field.locked && "opacity-50",
              )}
            />
            <PaletteSwatches colors={parseHexList(field.value)} />
          </div>
        ) : (
          <input
            value={field.value}
            disabled={field.locked}
            onChange={(e) => onEdit(e.target.value)}
            aria-label={label}
            data-testid={`${testId}-input`}
            className={cn(
              "w-full bg-transparent font-sans text-[0.8125rem] text-foreground outline-none focus:text-primary",
              field.locked && "opacity-50",
            )}
          />
        )}
      </div>
      <ProvenanceBadge source={field.source} className="flex-shrink-0" />
    </div>
  );
}

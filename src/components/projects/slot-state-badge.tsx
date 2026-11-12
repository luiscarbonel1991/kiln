import { Check } from "lucide-react";
import type { SlotView } from "@/domain/plan";
import { cn } from "@/lib/utils";

// Slot states in the provenance hues (globals.css): pine = exact / approved
// (true to the spec), terracotta = the maker's own photo, slate = to review,
// primary = generating, amber = retrying.
const STYLE: Record<SlotView["state"], { label: string; className: string }> = {
  off: {
    label: "off",
    className: "text-on-surface-dim bg-transparent ring-1 ring-border",
  },
  exact: { label: "exact", className: "text-prov-recipe bg-prov-recipe/10" },
  kept: { label: "your photo", className: "text-prov-local bg-prov-local/10" },
  queued: { label: "queued", className: "text-on-surface-dim bg-surface-soft" },
  generating: {
    label: "generating",
    className: "text-primary bg-primary/10 animate-pulse",
  },
  retrying: {
    label: "retrying",
    className: "text-prov-brand bg-prov-brand/10",
  },
  "to-review": {
    label: "to review",
    className: "text-prov-image bg-prov-image/10",
  },
  approved: {
    label: "approved",
    className: "text-prov-recipe bg-prov-recipe/10",
  },
  delivered: { label: "delivered", className: "text-card bg-foreground" },
};

export function SlotStateBadge({ view }: { view: SlotView }) {
  // "queued" in the batch vs "waiting" for the maker to generate it.
  const style = view.failed
    ? { label: "failed", className: "text-fail bg-fail/10" }
    : view.state === "queued" && !view.inBatch
      ? { label: "waiting", className: STYLE.queued.className }
      : view.state === "queued"
        ? { label: "queued", className: "text-primary bg-primary/10" }
        : STYLE[view.state];
  return (
    <span
      title={view.failed ? view.error : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-badge px-[7px] py-0.5 font-mono text-[0.59375rem]",
        style.className,
      )}
    >
      {view.state === "approved" && !view.failed ? (
        <Check className="size-2.5" />
      ) : null}
      {style.label}
    </span>
  );
}

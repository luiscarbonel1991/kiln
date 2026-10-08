import type { ReactNode } from "react";
import { SlotStateBadge } from "@/components/projects/slot-state-badge";
import type { SlotView } from "@/domain/plan";
import { cn } from "@/lib/utils";

const css = (aspect?: string) => (aspect ?? "1:1").replace(":", " / ");

// A destination's frames as a wrapping grid: the whole deliverable visible at
// once, no sideways scrolling. Each frame spans two rows (render, caption) on a
// subgrid, so in every visual row the renders rest on one baseline — a 1:1 next
// to a 4:5 sits at the bottom of the taller cell — and the captions line up.
export function SlotGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-x-5">
      {children}
    </div>
  );
}

// One frame of the storyboard: the render at the slot's real aspect (render
// radius + render shadow, DESIGN.md), the position label ("Etsy photo 1"), the
// slot's job as a serif caption, and its state. A slot switched off stays in
// place, faded, so the maker can switch it back on.
export function SlotFrame({
  position,
  label,
  purpose,
  aspect,
  view,
  children,
  actions,
  mark,
}: {
  position: string;
  label: string;
  purpose: string;
  aspect?: string;
  view: SlotView;
  children: ReactNode;
  actions?: ReactNode;
  // A note on what the render shows ("earlier version"), under its state.
  mark?: string;
}) {
  return (
    <figure className="row-span-2 grid min-w-0 grid-rows-subgrid gap-y-2">
      <div
        className={cn(
          "self-end overflow-hidden rounded-render bg-surface-soft shadow-render transition-opacity",
          view.state === "off" && "opacity-35 grayscale",
        )}
        style={{ aspectRatio: css(aspect) }}
      >
        {children}
      </div>
      <figcaption className="flex flex-col gap-1 self-start px-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.625rem] text-on-surface-dim">
            {position}
          </span>
          <SlotStateBadge view={view} />
        </div>
        {mark ? (
          <span className="font-mono text-[0.59rem] text-prov-brand">
            {mark}
          </span>
        ) : null}
        <span
          className="font-serif text-[0.95rem] italic leading-tight text-foreground"
          style={{ fontVariationSettings: "'opsz' 40" }}
        >
          {label}
        </span>
        <span className="font-sans text-[0.72rem] leading-snug text-on-surface-mid">
          {purpose}
        </span>
        {actions ? <div className="pt-1">{actions}</div> : null}
      </figcaption>
    </figure>
  );
}

// "Etsy photo 3" on a sale destination, "Slide 3" on a content one; the
// number counts only the slots switched on (`index` null = off).
export function slotPosition(
  destination: { name: string; kind: "sale" | "content" },
  index: number | null,
): string {
  if (index === null) {
    return destination.kind === "sale"
      ? `${destination.name} · off`
      : "Slide · off";
  }
  return destination.kind === "sale"
    ? `${destination.name} photo ${index + 1}`
    : `Slide ${index + 1}`;
}

// Each slot's place among the slots switched on (null when off).
export function onIndexes(off: boolean[]): (number | null)[] {
  let next = 0;
  return off.map((isOff) => (isOff ? null : next++));
}

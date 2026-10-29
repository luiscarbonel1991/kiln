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
  cost,
  ranOn,
  testId,
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
  // What the frame has cost so far, its takes included ("$0.12 · 2 takes").
  cost?: string;
  // Its latest take moved down its route: the model it ran on, from which,
  // and why (never switched unseen).
  ranOn?: { label: string; from: string; reason: string };
  // The frame's own id, so its controls can be found inside it; its state is
  // data-state.
  testId?: string;
}) {
  return (
    <figure
      data-testid={testId}
      data-state={view.state}
      className="row-span-2 grid min-w-0 grid-rows-subgrid gap-y-2"
    >
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
        {cost ? (
          <span
            className="font-mono text-[0.59rem] text-on-surface-dim"
            data-testid="frame-cost"
          >
            {cost}
          </span>
        ) : null}
        {ranOn ? (
          <span
            className="font-mono text-[0.59rem] leading-snug text-prov-image"
            data-testid="frame-ran-on"
          >
            {ranOn.label} · from {ranOn.from}: {ranOn.reason}
          </span>
        ) : null}
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

// A frame's position on the board and the plan: a video and a standalone
// frame (a story, a single post) are named by what they are and take no
// number; every other frame by its place among those switched on.
export function framePosition(
  destination: { name: string; kind: "sale" | "content" },
  slot: { fill: string; standalone?: boolean; label: string },
  index: number | null,
  off: boolean,
): string {
  if (slot.fill === "video") return `${destination.name} video`;
  if (slot.standalone) {
    return `${destination.name} ${slot.label.toLowerCase()}${off ? " · off" : ""}`;
  }
  return slotPosition(destination, index);
}

// The slots that take no number: off, a video, a frame posted on its own.
export function unnumbered(slot: {
  fill: string;
  standalone?: boolean;
}): boolean {
  return slot.fill === "video" || slot.standalone === true;
}

// Each slot's place among the slots switched on (null when off).
export function onIndexes(off: boolean[]): (number | null)[] {
  let next = 0;
  return off.map((isOff) => (isOff ? null : next++));
}

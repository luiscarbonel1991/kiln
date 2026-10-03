import type { ReactNode } from "react";
import { SlotStateBadge } from "@/components/projects/slot-state-badge";
import type { SlotView } from "@/domain/plan";

// One frame of the storyboard: the render at the slot's real aspect (render
// radius + render shadow, DESIGN.md), the position label ("Etsy photo 1"), the
// slot's job as a serif caption, and its state.
export function SlotFrame({
  position,
  label,
  purpose,
  aspect,
  view,
  children,
  actions,
}: {
  position: string;
  label: string;
  purpose: string;
  aspect?: string;
  view: SlotView;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const [w, h] = (aspect ?? "1:1").split(":");
  return (
    <figure className="flex w-[208px] flex-shrink-0 flex-col gap-2">
      <div
        className="overflow-hidden rounded-render bg-surface-soft shadow-render"
        style={{ aspectRatio: `${w} / ${h}` }}
      >
        {children}
      </div>
      <figcaption className="flex flex-col gap-1 px-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.625rem] text-on-surface-dim">
            {position}
          </span>
          <SlotStateBadge view={view} />
        </div>
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

// "Etsy photo 3" on a sale destination, "Slide 3" on a content one.
export function slotPosition(
  destination: { name: string; kind: "sale" | "content" },
  index: number,
): string {
  return destination.kind === "sale"
    ? `${destination.name} photo ${index + 1}`
    : `Slide ${index + 1}`;
}

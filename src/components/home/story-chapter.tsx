"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type Phase = "still" | "armed" | "played";

// One chapter of Home's story (DESIGN.md "Motion"): its copy, and a stage
// whose parts play one staggered sequence the first time the chapter comes
// into view. A chapter already on screen when the page opens, or any chapter
// when the maker asks for reduced motion, stays still, every part in place.
export function StoryChapter({
  id,
  number,
  eyebrow,
  title,
  children,
  stage,
  flip = false,
}: {
  id: string;
  number: number;
  eyebrow: string;
  title: string;
  children: ReactNode;
  stage: ReactNode;
  flip?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>("still");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setPhase("armed");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("played");
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      ref={ref}
      id={id}
      data-story={phase}
      data-testid={`story-${id}`}
      aria-labelledby={`${id}-title`}
      className={`grid scroll-mt-24 grid-cols-1 items-center gap-8 lg:gap-14 ${
        flip
          ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
          : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      }`}
    >
      <div className={`flex flex-col gap-3 ${flip ? "lg:order-2" : ""}`}>
        <p className="story-part flex items-center gap-3 font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
          <span className="font-mono text-[0.75rem] tracking-normal text-primary">
            {String(number).padStart(2, "0")}
          </span>
          {eyebrow}
        </p>
        <h2
          id={`${id}-title`}
          className="story-part font-serif text-[1.75rem] font-semibold leading-[1.12] text-foreground sm:text-[2.1rem]"
          style={{ fontVariationSettings: "'opsz' 144", ["--i" as string]: 1 }}
        >
          {title}
        </h2>
        <div
          className="story-part flex max-w-[460px] flex-col gap-3 font-sans text-[0.9375rem] leading-relaxed text-on-surface-mid"
          style={{ ["--i" as string]: 2 }}
        >
          {children}
        </div>
      </div>
      <div className={flip ? "lg:order-1" : ""}>{stage}</div>
    </section>
  );
}

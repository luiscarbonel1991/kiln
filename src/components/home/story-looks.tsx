"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

const STEP_MS = 1600;

// 5. Every look: the product drawn in each of its colours. While the stage
// is in view it walks through them once and comes back to the first; a
// swatch shows its colour at once. Under reduced motion it never walks.
export function StoryLooks({
  looks,
  frames,
  sample,
}: {
  looks: { key: string; name: string; face: string }[];
  frames: ReactNode[];
  sample: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [walked, setWalked] = useState(false);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!inView || walked || looks.length < 2) return;
    const timer = setInterval(() => {
      setShown((n) => {
        const next = (n + 1) % looks.length;
        if (next === 0) setWalked(true);
        return next;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [inView, walked, looks.length]);
  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-card bg-card p-5 shadow-card sm:p-8"
    >
      {sample ? (
        <div className="-mt-1 mb-3 flex justify-end">
          <span className="inline-flex rounded-pill bg-prov-brand/10 px-2.5 py-1 font-mono text-[0.625rem] text-prov-brand">
            sample
          </span>
        </div>
      ) : null}
      <div className="story-part story-develop relative mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-render bg-surface-soft shadow-render">
        {frames.map((frame, n) => (
          <div
            key={looks[n]?.key ?? n}
            aria-hidden={n !== shown}
            className="absolute inset-0 transition-opacity duration-500 ease-out [&_svg]:size-full"
            style={{ opacity: n === shown ? 1 : 0 }}
          >
            {frame}
          </div>
        ))}
      </div>
      <fieldset className="mt-6 flex flex-wrap justify-center gap-3">
        <legend className="sr-only">Colours</legend>
        {looks.map((look, n) => (
          <button
            key={look.key}
            type="button"
            data-testid={`story-look-${look.key}`}
            aria-pressed={n === shown}
            onClick={() => {
              setWalked(true);
              setShown(n);
            }}
            className={`story-part story-stamp flex items-center gap-2 rounded-pill px-3 py-1.5 font-sans text-[0.8rem] transition-colors ${
              n === shown
                ? "bg-surface-soft text-foreground"
                : "text-on-surface-mid hover:text-foreground"
            }`}
            style={{ ["--i" as string]: 4 + n }}
          >
            <span
              className={`size-5 rounded-swatch shadow-[0_4px_10px_-4px_rgba(50,32,18,0.35)] ${
                n === shown
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
                  : ""
              }`}
              style={{ backgroundColor: look.face }}
            />
            {look.name}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

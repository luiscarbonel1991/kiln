"use client";

import { Check, Store } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { StoryDestination } from "@/lib/home-story";

const STEP_MS = 1500;
const HEIGHT = 260;

const ratio = (aspect: string) => {
  const [w, h] = aspect.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
};

// 7. Everywhere it sells: one frame taking each destination's shape in turn
// (it walks the formats once while in view), and the destinations Kiln
// knows, marked where this project delivers and where Kiln made a draft.
export function StoryDestinations({
  destinations,
  frame,
}: {
  destinations: StoryDestination[];
  frame: ReactNode;
}) {
  const formats = useMemo(
    () =>
      destinations.flatMap((d) =>
        d.aspects.map((aspect) => ({ id: d.id, name: d.name, aspect })),
      ),
    [destinations],
  );
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [inView, setInView] = useState(false);
  const [walked, setWalked] = useState(false);
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
    if (!inView || walked || formats.length < 2) return;
    const timer = setInterval(() => {
      setShown((n) => {
        const next = (n + 1) % formats.length;
        if (next === 0) setWalked(true);
        return next;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [inView, walked, formats.length]);
  const now = formats[shown];
  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-card bg-card p-5 shadow-card sm:p-8"
    >
      <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[1fr_auto]">
        <div
          className="story-part flex items-center justify-center"
          style={{ height: HEIGHT }}
        >
          <div
            className="overflow-hidden rounded-render bg-surface-soft shadow-render transition-[width] duration-700 ease-[cubic-bezier(0.22,0.61,0.36,1)] [&_img]:size-full [&_img]:object-cover [&_svg]:size-full"
            style={{
              height: HEIGHT,
              width: Math.round(HEIGHT * ratio(now?.aspect ?? "1:1")),
            }}
          >
            {frame}
          </div>
        </div>
        <ul className="flex flex-col gap-2" aria-label="Where it sells">
          {destinations.map((d, n) => (
            <li
              key={d.id}
              className={`story-part flex items-center justify-between gap-4 rounded-field px-3 py-2 transition-colors ${
                now?.id === d.id ? "bg-surface-soft" : ""
              }`}
              style={{ ["--i" as string]: 4 + n }}
            >
              <span className="flex flex-col">
                <span className="font-sans text-[0.875rem] font-semibold text-foreground">
                  {d.name}
                </span>
                <span className="font-mono text-[0.625rem] text-on-surface-mid">
                  {d.aspects.join(" · ")}
                </span>
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[0.6rem]">
                {d.drafted ? (
                  <span className="inline-flex items-center gap-1 text-prov-recipe">
                    <Store className="size-3" /> draft made
                  </span>
                ) : d.used ? (
                  <span className="inline-flex items-center gap-1 text-prov-recipe">
                    <Check className="size-3" /> in this project
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p
        className="mt-4 font-mono text-[0.65rem] text-on-surface-mid"
        aria-live="off"
      >
        {now ? `${now.name} · ${now.aspect}` : null}
      </p>
    </div>
  );
}

"use client";

import { useEffect } from "react";

// What waits for the visitor before it moves: paper that lands, text that
// rises, and the few drawings that are traced. The stylesheet decides how
// each one moves; this only says when it has come into view.
const WAITS = [
  ".kl-pile > *",
  ".kl-band .print",
  ".kl-band .kl-slip",
  ".kl-knobs",
  ".kl-receipt > ul",
  ".kl-head > *",
  ".kl-starts > h2",
  ".kl-starts li",
  ".kl-routes li",
  ".kl-lenses li",
  ".kl-reasons",
  ".kl-moves-copy",
  ".kl-after > div",
  ".kl-cost-copy",
  ".kl-plans",
  ".kl-close > *",
  ".kl-measure",
].join(",");

// Marks what is below the fold as waiting, and releases each piece once as it
// scrolls in. Without it, or under reduced motion, the page is simply still.
export function Reveal() {
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      return;
    }
    const root = document.querySelector(".kl");
    if (!root) return;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) el.dataset.reveal = "in";
          else if (entry.boundingClientRect.bottom < 0)
            delete el.dataset.reveal;
          else continue;
          seen.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    const fold = window.innerHeight;
    for (const el of root.querySelectorAll<HTMLElement>(WAITS)) {
      if (el.dataset.reveal === "in") continue;
      if (el.getBoundingClientRect().top < fold) continue;
      el.dataset.reveal = "wait";
      seen.observe(el);
    }
    return () => seen.disconnect();
  }, []);
  return null;
}

import type { CSSProperties } from "react";

// Marks made by hand on a print with a wax pencil: a tick, a ring around what
// was read, a cross. Each stroke has pathLength 1, so CSS can draw it.

const STROKE = {
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  pathLength: 1,
  vectorEffect: "non-scaling-stroke",
} as const;

// The roughness every wax stroke shares. Render once per page.
export function WaxDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="wax-rough" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.85"
          numOctaves="2"
          seed="4"
          result="noise"
        />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" />
      </filter>
    </svg>
  );
}

export function WaxTick({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`wax ${className ?? ""}`}
      style={style}
      aria-hidden
    >
      <path {...STROKE} d="M10 56 C20 62 30 74 36 88 C48 56 68 28 94 8" />
    </svg>
  );
}

export function WaxCross({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`wax ${className ?? ""}`}
      style={style}
      aria-hidden
    >
      <path {...STROKE} d="M12 14 C36 34 62 60 90 88" />
      <path {...STROKE} d="M88 10 C64 36 38 62 10 92" />
    </svg>
  );
}

export function WaxRing({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 300 100"
      preserveAspectRatio="none"
      className={`wax ${className ?? ""}`}
      style={style}
      aria-hidden
    >
      <path
        {...STROKE}
        d="M22 52 C14 22 78 6 158 8 C236 10 292 26 288 54 C284 84 196 96 128 93 C62 90 6 78 16 44 C22 26 54 14 92 10"
      />
    </svg>
  );
}

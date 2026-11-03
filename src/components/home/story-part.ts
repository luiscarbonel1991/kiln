import type { CSSProperties } from "react";

// A part of a story stage, played in its place in its chapter's sequence
// (90 ms apart, DESIGN.md "Motion").
export const at = (i: number, style: CSSProperties = {}): CSSProperties =>
  ({ ...style, "--i": i }) as CSSProperties;

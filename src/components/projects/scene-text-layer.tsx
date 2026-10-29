import { heightFor, WIDTH } from "@/components/projects/exact-slot-art";
import { SERIF_ITALIC_GLYPH, wrapText } from "@/components/projects/text-fit";

// A scene's text layer: the slot's headline on a band in the maker's brand
// colours, drawn by this template and never by the image model. Plain SVG over
// the scene's frame, so the board shows it and Deliver composites the same
// markup (through src/lib/svg-markup.ts and resvg) onto the approved image.
const INSET = 16;
const PAD_X = 14;
const PAD_Y = 11;
const SIZE = 22;
const LEAD = 1.22;
const MAX_LINES = 3;

export function SceneTextLayer({
  text,
  band,
  aspect,
}: {
  text: string;
  band: { background: string; ink: string };
  aspect?: string;
}) {
  const height = heightFor(aspect);
  // A story's top is under the app's own bar (profile, progress): the band
  // sits below it, in the safe zone (~13 % of the height).
  const top = height / WIDTH >= 1.7 ? Math.round(height * 0.13) : INSET;
  const { lines } = wrapText(
    text,
    WIDTH - 2 * INSET - 2 * PAD_X,
    SIZE,
    MAX_LINES,
    0,
    SERIF_ITALIC_GLYPH,
  );
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="block h-full w-full"
      aria-hidden="true"
    >
      <rect
        x={INSET}
        y={top}
        width={WIDTH - 2 * INSET}
        height={lines.length * SIZE * LEAD + 2 * PAD_Y}
        rx={13}
        fill={band.background}
      />
      {lines.map((line, i) => (
        <text
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          key={i}
          x={INSET + PAD_X}
          y={top + PAD_Y + SIZE * (0.86 + i * LEAD)}
          fill={band.ink}
          style={{
            fontFamily: "var(--font-fraunces)",
            fontSize: SIZE,
            fontStyle: "italic",
          }}
        >
          {line}
        </text>
      ))}
    </svg>
  );
}

// Reusable palette display: a row of color swatches from a hex list. Used by the
// Analysis phase, the Planning rows, and the card field rows.
export function PaletteSwatches({ colors }: { colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((hex, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: editable list may hold duplicate/partial hex while typing
          key={`${hex}-${i}`}
          title={hex}
          className="size-6 rounded-[7px] shadow-[0_1px_3px_rgba(50,32,18,0.18)]"
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}

// Parse a comma-separated hex list ("#aabbcc, #ddeeff") into trimmed entries.
export function parseHexList(value: string): string[] {
  return value
    .split(",")
    .map((hex) => hex.trim())
    .filter(Boolean);
}

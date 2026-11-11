// The sample board's face, drawn flat from its spec: its colour, its two lines
// of wording and its 16 x 10 proportion. Plain SVG, so it redraws at no cost
// whenever the spec changes.

const GRAIN = [
  "M0 22 C60 18 120 27 200 21 S290 24 320 20",
  "M0 47 C70 51 150 43 220 48 S300 45 320 49",
  "M0 71 C50 68 110 75 190 70 S280 73 320 69",
  "M0 96 C80 100 140 92 230 97 S295 94 320 98",
  "M0 122 C55 118 125 126 205 121 S285 124 320 120",
  "M0 148 C75 152 145 144 225 149 S300 146 320 150",
  "M0 174 C60 170 130 178 210 173 S290 176 320 172",
];

export function BoardFace({
  face,
  ink,
  name,
  year,
  label,
  className,
}: {
  face: string;
  ink: string;
  name: string;
  year?: string;
  // Read aloud in place of the drawing; without it the drawing is decoration.
  label?: string;
  className?: string;
}) {
  const size = Math.min(40, 440 / Math.max(name.length, 6));
  const hasYear = Boolean(year);
  const nameY = hasYear ? 98 : 112;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 200"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="320" height="200" rx="16" fill={face} />
      <g
        fill="none"
        stroke={ink}
        strokeOpacity="0.09"
        strokeWidth="1"
        clipPath="inset(0 round 16px)"
      >
        {GRAIN.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <text
        x="160"
        y={nameY}
        textAnchor="middle"
        fill={ink}
        fontSize={size}
        fontWeight="600"
        style={{
          fontFamily: "var(--font-fraunces)",
          fontVariationSettings: "'opsz' 144",
        }}
      >
        {name}
      </text>
      {hasYear ? (
        <>
          <rect x="130" y="118" width="60" height="1.6" fill={ink} />
          <text
            x="160"
            y="150"
            textAnchor="middle"
            fill={ink}
            fontSize="22"
            fontWeight="600"
            style={{
              fontFamily: "var(--font-fraunces)",
              fontVariationSettings: "'opsz' 144",
            }}
          >
            {year}
          </text>
        </>
      ) : null}
    </svg>
  );
}

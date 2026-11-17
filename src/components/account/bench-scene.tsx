import "./bench.css";

const PLATE =
  "M132 190H468A22 22 0 0 1 490 212V388A22 22 0 0 1 468 410H132A22 22 0 0 1 110 388V212A22 22 0 0 1 132 190Z";
const LINES = [60, 120, 180, 240, 300, 360, 420, 480, 540];

// The account pages' scene, drawn in code: a machine's bright point cuts a
// piece and its lettering, the piece takes its colour, a camera frames it and
// the check passes. It says what Kiln is for without showing a photo.
export function BenchScene() {
  return (
    <svg
      viewBox="0 0 600 600"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full"
      role="img"
      aria-label="A piece is cut and lettered, then framed by a camera and checked."
    >
      <g className="bench-grid">
        {LINES.map((n) => (
          <path key={n} d={`M${n} 0V600M0 ${n}H600`} />
        ))}
      </g>
      <text x="64" y="52" className="bench-tick">
        0
      </text>
      <text x="484" y="52" className="bench-tick">
        16 in
      </text>

      <path d={PLATE} className="bench-plate-fill" />
      <path d={PLATE} pathLength={1} className="bench-outline" />
      <rect
        x="126"
        y="206"
        width="348"
        height="188"
        rx="12"
        pathLength={1}
        className="bench-inset"
      />
      <text x="300" y="296" textAnchor="middle" className="bench-name">
        Your name
      </text>
      <path
        d="M262 326H338M276 326l-10-9M276 326l-10 9M292 326l-10-9M292 326l-10 9M308 326l-10-9M308 326l-10 9M324 326l-10-9M324 326l-10 9"
        pathLength={1}
        className="bench-sprig"
      />
      <text x="300" y="368" textAnchor="middle" className="bench-year">
        2026
      </text>
      <circle r="4.5" className="bench-head" />

      <rect width="600" height="600" className="bench-flash" />
      <path d="M86 196V166H116" className="bench-corner" />
      <path d="M484 166H514V196" className="bench-corner" />
      <path d="M514 404V434H484" className="bench-corner" />
      <path d="M116 434H86V404" className="bench-corner" />
      <g className="bench-chip">
        <rect x="392" y="446" width="122" height="26" rx="13" />
        <text x="453" y="463" textAnchor="middle">
          CHECKED · 2/2
        </text>
      </g>
    </svg>
  );
}

import "./bench.css";

// The product's outline, as a hand draws it: not quite closed, not quite
// straight. The second pass goes over the first, a little off.
const SKETCH_1 =
  "M150 224C240 219 372 222 452 221C466 221 471 229 471 240C473 290 470 352 472 398C472 412 465 419 452 420C360 423 236 419 149 421C136 421 130 414 130 402C128 350 131 292 129 242C129 230 136 224 152 223";
const SKETCH_2 =
  "M146 227C250 224 380 226 455 224C464 225 468 232 468 243C470 300 468 350 469 396C469 409 463 416 450 417C350 420 240 417 152 418C139 418 133 411 133 400C131 345 133 290 132 245C132 233 139 227 149 226";
const HATCH =
  "M140 404L162 382M140 388L150 378M152 412L176 388M168 414L188 394M440 236L462 258M448 230L464 246M430 232L462 264";

// The account pages' scene, drawn in code: a pencil sketch on paper becomes
// the product, and the product gets its photo, framed and checked. It tells
// Kiln's path (idea, product, generation) without showing a photo.
export function BenchScene() {
  return (
    <svg
      viewBox="0 0 600 600"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full"
      role="img"
      aria-label="A pencil sketch of a piece becomes the product, then a photo of it in a room, framed and checked."
    >
      <defs>
        <filter id="bench-pencil" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="4"
            result="grain"
          />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.6" />
        </filter>
        <filter id="bench-blur" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <linearGradient id="bench-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7a5038" />
          <stop offset="0.55" stopColor="#6b4530" />
          <stop offset="1" stopColor="#5a3826" />
        </linearGradient>
        <linearGradient id="bench-light" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6e6" stopOpacity="0.9" />
          <stop offset="0.6" stopColor="#fff6e6" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g className="bench-scene">
        <rect width="600" height="432" fill="#e7dcc8" />
        <path
          d="M0 144H600M0 288H600M150 0V144M450 0V144M300 144V288M0 144V288M600 144V288M150 288V432M450 288V432"
          stroke="#d6c9b2"
          strokeWidth="1.5"
          fill="none"
        />
        <rect width="600" height="432" fill="url(#bench-light)" />
        <g className="bench-counter">
          <rect y="428" width="600" height="172" fill="#d3c2a6" />
          <rect y="428" width="600" height="5" fill="#f3ead8" />
          <g transform="translate(508 318)">
            <path
              d="M20 60C8 40 6 18 18 0C30 18 30 40 20 60M20 62C36 46 50 40 62 22C44 26 28 38 20 62M20 62C6 50 -8 44 -20 30C-4 30 10 42 20 62"
              fill="#5d7a55"
            />
            <path d="M2 62H38L33 112H7Z" fill="#f6efe2" />
          </g>
        </g>
      </g>
      <ellipse
        cx="300"
        cy="432"
        rx="176"
        ry="13"
        fill="#3a2a1c"
        opacity="0.45"
        filter="url(#bench-blur)"
        className="bench-shadow"
      />

      <g className="bench-product">
        <rect
          x="130"
          y="222"
          width="340"
          height="198"
          rx="18"
          fill="url(#bench-wood)"
        />
        <rect
          x="146"
          y="238"
          width="308"
          height="166"
          rx="9"
          fill="none"
          stroke="#2a1a10"
          strokeWidth="1.4"
          opacity="0.7"
        />
        <text
          x="300"
          y="320"
          textAnchor="middle"
          className="bench-product-name"
        >
          Your name
        </text>
        <path
          d="M264 346H336M278 346l-9-8M278 346l-9 8M293 346l-9-8M293 346l-9 8M308 346l-9-8M308 346l-9 8M323 346l-9-8M323 346l-9 8"
          fill="none"
          stroke="#2a1a10"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text
          x="300"
          y="384"
          textAnchor="middle"
          className="bench-product-year"
        >
          2026
        </text>
      </g>
      <g className="bench-spec">
        <path d="M130 196H470M130 190V202M470 190V202" />
        <text x="300" y="186" textAnchor="middle">
          16 × 10 IN · WALNUT · ENGRAVED
        </text>
      </g>

      <g className="bench-sketch" filter="url(#bench-pencil)">
        <path d={SKETCH_1} pathLength={1} className="bench-line bench-l1" />
        <path
          d={SKETCH_2}
          pathLength={1}
          className="bench-line bench-line-soft bench-l2"
        />
        <path
          d="M150 242C250 239 360 241 452 240M452 240C454 300 452 350 453 402M453 402C350 405 250 402 149 404M149 404C147 350 150 300 150 242"
          pathLength={1}
          className="bench-line bench-line-soft bench-l3"
        />
        <text
          x="300"
          y="322"
          textAnchor="middle"
          className="bench-hand bench-hand-name"
        >
          Your name
        </text>
        <path
          d="M262 348C285 345 315 349 338 346M276 347l-10-9M277 347l-9 9M292 347l-10-8M293 347l-9 8M308 347l-9-9M309 347l-10 8"
          pathLength={1}
          className="bench-line bench-l4"
        />
        <path
          d={HATCH}
          pathLength={1}
          className="bench-line bench-line-soft bench-l4"
        />
        <path
          d="M132 196C240 193 360 197 470 194M132 196l12-7M132 196l12 8M470 194l-12-8M470 194l-11 8"
          pathLength={1}
          className="bench-line bench-line-soft bench-l5"
        />
        <text
          x="300"
          y="182"
          textAnchor="middle"
          className="bench-hand bench-hand-note"
        >
          16 in, walnut?
        </text>
      </g>

      <rect width="600" height="600" className="bench-flash" />
      <path d="M96 218V188H126" className="bench-corner" />
      <path d="M474 188H504V218" className="bench-corner" />
      <path d="M504 426V456H474" className="bench-corner" />
      <path d="M126 456H96V426" className="bench-corner" />
      <g className="bench-chip">
        <rect x="382" y="468" width="122" height="26" rx="13" />
        <text x="443" y="485" textAnchor="middle">
          CHECKED · 2/2
        </text>
      </g>

      <text x="96" y="92" className="bench-step bench-step-1">
        01 SKETCH
      </text>
      <text x="192" y="92" className="bench-step bench-step-2">
        02 PRODUCT
      </text>
      <text x="296" y="92" className="bench-step bench-step-3">
        03 PHOTO
      </text>
    </svg>
  );
}

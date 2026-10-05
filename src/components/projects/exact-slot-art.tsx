import { colourGridLayout } from "@/components/projects/colour-grid-layout";
import {
  contrastInk,
  type ExactView,
  type ProductOutline,
  type ScaleReference,
} from "@/domain/exact";

// Draws an exact slot from its view model: plain SVG, no image model, the same
// pixels every time. Product colours are the spec's hex values (render content);
// chrome uses the DESIGN tokens. The viewBox follows the slot's aspect.
const WIDTH = 400;

function heightFor(aspect: string | undefined): number {
  const [w, h] = (aspect ?? "1:1").split(":").map(Number);
  return w && h ? Math.round((WIDTH * h) / w) : WIDTH;
}

const SERIF = { fontFamily: "var(--font-fraunces)" };
const SANS = { fontFamily: "var(--font-hanken)" };
const MONO = { fontFamily: "var(--font-jetbrains-mono)" };

// `plate` is the product's own plate image (a vector product's SVG) for the
// frames drawn to scale; without it they draw the product's outline.
export function ExactSlotArt({
  view,
  aspect,
  plate,
}: {
  view: ExactView;
  aspect?: string;
  plate?: string | null;
}) {
  const height = heightFor(aspect);
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="block h-full w-full"
      role="img"
      aria-label={view.title}
    >
      <rect
        width={WIDTH}
        height={height}
        className={view.kind === "text-card" ? "fill-primary" : "fill-card"}
      />
      {view.kind === "colour-grid" ? (
        <ColourGrid view={view} height={height} />
      ) : null}
      {view.kind === "size-spec" ? (
        <SizeSpec view={view} height={height} plate={plate ?? null} />
      ) : null}
      {view.kind === "scale" ? (
        <ScaleDrawing view={view} height={height} plate={plate ?? null} />
      ) : null}
      {view.kind === "personalize" ? (
        <Personalize view={view} height={height} />
      ) : null}
      {view.kind === "text-card" ? (
        <TextCard view={view} height={height} />
      ) : null}
    </svg>
  );
}

function Title({ text, y = 58 }: { text: string; y?: number }) {
  return (
    <text
      x={WIDTH / 2}
      y={y}
      textAnchor="middle"
      className="fill-foreground"
      style={{ ...SERIF, fontSize: 26, fontStyle: "italic" }}
    >
      {text}
    </text>
  );
}

function ColourGrid({
  view,
  height,
}: {
  view: Extract<ExactView, { kind: "colour-grid" }>;
  height: number;
}) {
  const layout = colourGridLayout({
    names: view.swatches.map((s) => s.name),
    inStock: view.swatches.map((s) => s.inStock),
    width: WIDTH,
    height,
    top: 92,
  });
  const { swatch, fontSize, lineHeight } = layout;
  return (
    <g>
      <Title text={view.title} />
      {view.swatches.map((s, i) => {
        const cell = layout.cells[i];
        return (
          <g key={s.key} opacity={s.inStock ? 1 : 0.45}>
            <rect
              x={cell.cx - swatch / 2}
              y={cell.swatchY}
              width={swatch}
              height={swatch}
              rx={Math.min(14, swatch / 5)}
              fill={s.face}
              className="stroke-border"
              strokeWidth={1}
            />
            {s.inlay ? (
              <text
                x={cell.cx}
                y={cell.swatchY + swatch / 2 + swatch * 0.1}
                textAnchor="middle"
                fill={s.inlay}
                style={{ ...SERIF, fontSize: swatch * 0.28 }}
              >
                Aa
              </text>
            ) : null}
            {cell.lines.map((line, l) => (
              <text
                key={line}
                x={cell.cx}
                y={cell.nameY + l * lineHeight}
                textAnchor="middle"
                className="fill-foreground"
                style={{ ...SANS, fontSize, fontWeight: 600 }}
              >
                {line}
              </text>
            ))}
            {cell.stockY !== undefined ? (
              <text
                x={cell.cx}
                y={cell.stockY}
                textAnchor="middle"
                className="fill-on-surface-mid"
                style={{ ...MONO, fontSize: 10 }}
              >
                out of stock
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

const fmtSize = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");

// The product at (x, y, w, h): its plate image, or its outline in its default
// colour with the wording an example piece would carry.
function ProductShape({
  outline,
  plate,
  x,
  y,
  w,
  h,
}: {
  outline: ProductOutline;
  plate: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  if (plate) {
    return (
      <image
        href={plate}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  const ink = contrastInk(outline.face);
  const lines = outline.wording.slice(0, 3);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const fontSize = Math.max(
    6,
    Math.min(
      (h * 0.5) / Math.max(1, lines.length),
      (w * 0.8) / (longest * 0.62),
    ),
  );
  return (
    <g>
      {outline.round ? (
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={outline.face}
          className="stroke-on-surface-mid"
          strokeWidth={1}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.08}
          fill={outline.face}
          className="stroke-on-surface-mid"
          strokeWidth={1}
        />
      )}
      {lines.map((line, i) => (
        <text
          key={line}
          x={x + w / 2}
          y={
            y +
            h / 2 +
            (i - (lines.length - 1) / 2) * fontSize * 1.15 +
            fontSize * 0.35
          }
          textAnchor="middle"
          fill={ink}
          style={{ ...SANS, fontSize, fontWeight: 600 }}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

// An everyday object's silhouette, in the chrome's neutral tones.
function ReferenceShape({
  reference,
  x,
  y,
  w,
  h,
}: {
  reference: ScaleReference;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const body = "fill-surface-soft stroke-on-surface-mid";
  const detail = "fill-on-surface-dim/25";
  switch (reference.key) {
    case "card":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={w * 0.05}
            className={body}
            strokeWidth={1}
          />
          <rect
            x={x + w * 0.1}
            y={y + h * 0.32}
            width={w * 0.17}
            height={h * 0.24}
            rx={2}
            className={detail}
          />
          <rect
            x={x + w * 0.1}
            y={y + h * 0.72}
            width={w * 0.6}
            height={h * 0.07}
            rx={1}
            className={detail}
          />
        </g>
      );
    case "phone":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={w * 0.16}
            className={body}
            strokeWidth={1}
          />
          <rect
            x={x + w * 0.07}
            y={y + h * 0.05}
            width={w * 0.86}
            height={h * 0.9}
            rx={w * 0.1}
            className={detail}
          />
        </g>
      );
    case "letter":
      return (
        <g>
          <path
            d={`M${x} ${y} H${x + w * 0.86} L${x + w} ${y + w * 0.14} V${y + h} H${x} Z`}
            className={body}
            strokeWidth={1}
          />
          {[0.22, 0.3, 0.38, 0.46, 0.54].map((f) => (
            <rect
              key={f}
              x={x + w * 0.12}
              y={y + h * f}
              width={w * (f === 0.54 ? 0.45 : 0.76)}
              height={Math.max(1, h * 0.012)}
              className={detail}
            />
          ))}
        </g>
      );
    case "door":
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            className={body}
            strokeWidth={1}
          />
          <rect
            x={x + w * 0.14}
            y={y + h * 0.06}
            width={w * 0.72}
            height={h * 0.38}
            className={detail}
          />
          <rect
            x={x + w * 0.14}
            y={y + h * 0.5}
            width={w * 0.72}
            height={h * 0.44}
            className={detail}
          />
          <circle
            cx={x + w * 0.88}
            cy={y + h * 0.5}
            r={Math.max(2, w * 0.035)}
            className="fill-on-surface-mid"
          />
        </g>
      );
  }
}

// The product drawn to scale beside an everyday object of a similar size, on
// one baseline, with a ruler under the product in its own unit.
function ScaleDrawing({
  view,
  height,
  plate,
}: {
  view: Extract<ExactView, { kind: "scale" }>;
  height: number;
  plate: string | null;
}) {
  const { product: p, reference: r } = view;
  const gapU = Math.max(p.width, r.width) * 0.3;
  // The drawing fits between the title and the labels under it, centred
  // vertically when the width is what limits it.
  const top = 92;
  const bottom = height - 96;
  const k = Math.min(
    (WIDTH - 80) / (p.width + gapU + r.width),
    (bottom - top) / Math.max(p.height, r.height),
  );
  const baseline = top + (bottom - top + Math.max(p.height, r.height) * k) / 2;
  const x0 = (WIDTH - (p.width + gapU + r.width) * k) / 2;
  const px = x0;
  const rx = x0 + (p.width + gapU) * k;
  // Ruler under the product: whole units (cm for a product in mm), at most
  // about ten ticks.
  const metric = p.unit === "mm";
  const unitLen = metric ? 10 : 1;
  const steps = metric ? [1, 2, 5, 10, 20, 50] : [1, 2, 6, 12];
  const span = Math.ceil(p.width / unitLen);
  const step = steps.find((s) => span / s <= 10) ?? steps[steps.length - 1];
  const ticks = Array.from(
    { length: Math.floor(span / step) + 1 },
    (_unused, i) => i * step,
  );
  const rulerY = baseline + 12;
  return (
    <g>
      <Title text={view.title} />
      <ProductShape
        outline={p}
        plate={plate}
        x={px}
        y={baseline - p.height * k}
        w={p.width * k}
        h={p.height * k}
      />
      <ReferenceShape
        reference={r}
        x={rx}
        y={baseline - r.height * k}
        w={r.width * k}
        h={r.height * k}
      />
      <line
        x1={x0 - 10}
        x2={WIDTH - x0 + 10}
        y1={baseline}
        y2={baseline}
        className="stroke-on-surface-dim"
        strokeWidth={1}
      />
      <line
        x1={px}
        x2={px + span * unitLen * k}
        y1={rulerY}
        y2={rulerY}
        className="stroke-foreground"
        strokeWidth={1}
      />
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={px + t * unitLen * k}
            x2={px + t * unitLen * k}
            y1={rulerY}
            y2={rulerY + 6}
            className="stroke-foreground"
            strokeWidth={1}
          />
          <text
            x={px + t * unitLen * k}
            y={rulerY + 17}
            textAnchor="middle"
            className="fill-on-surface-mid"
            style={{ ...MONO, fontSize: 9 }}
          >
            {t}
          </text>
        </g>
      ))}
      <text
        x={px + span * unitLen * k + 6}
        y={rulerY + 4}
        className="fill-on-surface-mid"
        style={{ ...MONO, fontSize: 9 }}
      >
        {metric ? "cm" : "in"}
      </text>
      <text
        x={px + (p.width * k) / 2}
        y={rulerY + 44}
        textAnchor="middle"
        className="fill-foreground"
        style={{ ...MONO, fontSize: 11 }}
      >
        {fmtSize(p.width)} x {fmtSize(p.height)} {p.unit}
      </text>
      <text
        x={rx + (r.width * k) / 2}
        y={rulerY + 44}
        textAnchor="middle"
        className="fill-on-surface-mid"
        style={{ ...SANS, fontSize: 11 }}
      >
        {r.name}
      </text>
      <text
        x={rx + (r.width * k) / 2}
        y={rulerY + 58}
        textAnchor="middle"
        className="fill-on-surface-dim"
        style={{ ...MONO, fontSize: 9 }}
      >
        {fmtSize(r.width)} x {fmtSize(r.height)} {p.unit}
      </text>
    </g>
  );
}

function SizeSpec({
  view,
  height,
  plate,
}: {
  view: Extract<ExactView, { kind: "size-spec" }>;
  height: number;
  plate: string | null;
}) {
  const boxMaxW = WIDTH - 140;
  const boxMaxH = height * 0.3;
  const scale = Math.min(boxMaxW / view.width, boxMaxH / view.height);
  const w = view.width * scale;
  const h = view.height * scale;
  const x = (WIDTH - w) / 2;
  const y = 92;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return (
    <g>
      <Title text={view.title} />
      <ProductShape
        outline={view.product}
        plate={plate}
        x={x}
        y={y}
        w={w}
        h={h}
      />
      <line
        x1={x}
        x2={x + w}
        y1={y + h + 18}
        y2={y + h + 18}
        className="stroke-on-surface-mid"
        strokeWidth={1}
      />
      <text
        x={WIDTH / 2}
        y={y + h + 36}
        textAnchor="middle"
        className="fill-foreground"
        style={{ ...MONO, fontSize: 12 }}
      >
        {fmt(view.width)} {view.unit}
      </text>
      <line
        x1={x + w + 18}
        x2={x + w + 18}
        y1={y}
        y2={y + h}
        className="stroke-on-surface-mid"
        strokeWidth={1}
      />
      <text
        x={x + w + 26}
        y={y + h / 2 + 4}
        className="fill-foreground"
        style={{ ...MONO, fontSize: 12 }}
      >
        {fmt(view.height)} {view.unit}
      </text>
      {view.facts.map((f, i) => (
        <g key={f.label}>
          <text
            x={70}
            y={y + h + 62 + i * 22}
            className="fill-on-surface-dim"
            style={{ ...SANS, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}
          >
            {f.label.toUpperCase()}
          </text>
          <text
            x={170}
            y={y + h + 62 + i * 22}
            className="fill-foreground"
            style={{ ...SANS, fontSize: 13 }}
          >
            {f.value}
          </text>
        </g>
      ))}
      {view.depth ? (
        <text
          x={WIDTH / 2}
          y={height - 24}
          textAnchor="middle"
          className="fill-on-surface-mid"
          style={{ ...MONO, fontSize: 11 }}
        >
          {fmt(view.depth)} {view.unit} thick
        </text>
      ) : null}
    </g>
  );
}

function Personalize({
  view,
  height,
}: {
  view: Extract<ExactView, { kind: "personalize" }>;
  height: number;
}) {
  const top = 110;
  const step = Math.min(
    96,
    (height - top - 30) / Math.max(1, view.lines.length),
  );
  return (
    <g>
      <Title text={view.title} />
      {view.lines.map((line, i) => {
        const y = top + i * step;
        return (
          <g key={line.label}>
            <text
              x={56}
              y={y}
              className="fill-on-surface-dim"
              style={{
                ...SANS,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              {`${i + 1}. ${line.label.toUpperCase()}${line.required ? "" : " (OPTIONAL)"}`}
            </text>
            <rect
              x={56}
              y={y + 10}
              width={WIDTH - 112}
              height={40}
              rx={13}
              className="fill-surface-soft stroke-border"
              strokeWidth={1}
            />
            <text
              x={72}
              y={y + 36}
              className="fill-foreground"
              style={{ ...SERIF, fontSize: 18 }}
            >
              {line.example ?? ""}
            </text>
            {line.maxChars ? (
              <text
                x={WIDTH - 72}
                y={y + 36}
                textAnchor="end"
                className="fill-on-surface-mid"
                style={{ ...MONO, fontSize: 11 }}
              >
                max {line.maxChars}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function TextCard({
  view,
  height,
}: {
  view: Extract<ExactView, { kind: "text-card" }>;
  height: number;
}) {
  return (
    <g>
      <text
        x={WIDTH / 2}
        y={height / 2}
        textAnchor="middle"
        className="fill-primary-foreground"
        style={{ ...SERIF, fontSize: 34, fontStyle: "italic" }}
      >
        {view.title}
      </text>
      <text
        x={WIDTH / 2}
        y={height / 2 + 34}
        textAnchor="middle"
        className="fill-primary-foreground"
        style={{ ...SANS, fontSize: 12, fontWeight: 700, letterSpacing: 3 }}
      >
        {view.subtitle.toUpperCase()}
      </text>
    </g>
  );
}

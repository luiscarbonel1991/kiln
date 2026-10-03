import type { ExactView } from "@/domain/exact";

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

export function ExactSlotArt({
  view,
  aspect,
}: {
  view: ExactView;
  aspect?: string;
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
        <SizeSpec view={view} height={height} />
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
  const n = view.swatches.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const size = Math.min(96, (WIDTH - 80) / cols - 20);
  const top = 100;
  const rowH = Math.min(size + 52, (height - top - 20) / rows);
  return (
    <g>
      <Title text={view.title} />
      {view.swatches.map((s, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = WIDTH / 2 + (col - (cols - 1) / 2) * (size + 24);
        const y = top + row * rowH;
        return (
          <g key={s.key} opacity={s.inStock ? 1 : 0.45}>
            <rect
              x={cx - size / 2}
              y={y}
              width={size}
              height={size}
              rx={14}
              fill={s.face}
              className="stroke-border"
              strokeWidth={1}
            />
            {s.inlay ? (
              <text
                x={cx}
                y={y + size / 2 + 9}
                textAnchor="middle"
                fill={s.inlay}
                style={{ ...SERIF, fontSize: 26 }}
              >
                Aa
              </text>
            ) : null}
            <text
              x={cx}
              y={y + size + 22}
              textAnchor="middle"
              className="fill-foreground"
              style={{ ...SANS, fontSize: 14, fontWeight: 600 }}
            >
              {s.name}
            </text>
            {s.inStock ? null : (
              <text
                x={cx}
                y={y + size + 38}
                textAnchor="middle"
                className="fill-on-surface-mid"
                style={{ ...MONO, fontSize: 10 }}
              >
                out of stock
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function SizeSpec({
  view,
  height,
}: {
  view: Extract<ExactView, { kind: "size-spec" }>;
  height: number;
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
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        className="fill-surface-soft stroke-on-surface-mid"
        strokeWidth={1.5}
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

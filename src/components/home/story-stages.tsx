import { ArrowRight, Check } from "lucide-react";
import type { CSSProperties } from "react";
import { at } from "@/components/home/story-part";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { SAMPLE_DESIGN } from "@/lib/home-sample";
import type {
  StoryDesign,
  StoryFrame,
  StoryProduct,
  StoryScene,
  StoryWords,
} from "@/lib/home-story";
import type { PlateImage } from "@/lib/plate-href";

// The stages of Home's story: what each chapter shows, built from the
// maker's work or the sample, its parts numbered for the chapter's one
// sequence (story-part, at()). The copy plays as parts 0 to 2.

const STAGE =
  "relative overflow-hidden rounded-card bg-card p-5 shadow-card sm:p-8";
const MICRO =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const CHIP =
  "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-mono text-[0.625rem]";

// Content from the sample product, said so above the stage (in the flow, so
// it never covers what it marks).
export function SampleMark({ shown }: { shown: boolean }) {
  return shown ? (
    <div className="-mt-1 mb-3 flex justify-end">
      <span className={`${CHIP} bg-prov-brand/10 text-prov-brand`}>sample</span>
    </div>
  ) : null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

// 1. The product: its spec card assembling, line by line.
export function SpecStage({
  product,
  sample,
}: {
  product: StoryProduct;
  sample: boolean;
}) {
  const facts: [string, string][] = [
    ["Size", product.size],
    ["Material", product.material],
    ["Finish", product.finish],
    ...(product.price !== undefined
      ? ([["Price", money(product.price)]] as [string, string][])
      : []),
  ];
  let i = 3;
  return (
    <div className={STAGE}>
      <SampleMark shown={sample} />
      <p
        className="story-part font-mono text-[0.65rem] text-on-surface-dim"
        style={at(i++)}
      >
        {product.sku}
      </p>
      <p
        className="story-part mt-1 max-w-[85%] font-serif text-[1.6rem] italic leading-tight text-foreground"
        style={at(i++)}
      >
        {product.name}
      </p>
      <dl className="mt-6 flex flex-col gap-2.5">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="story-part grid grid-cols-[5.5rem_1fr] items-baseline gap-4"
            style={at(i++)}
          >
            <dt className={MICRO}>{label}</dt>
            <dd className="font-sans text-[0.9rem] text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-col gap-2">
        <span className={MICRO}>Colours</span>
        <div className="flex flex-wrap gap-3">
          {product.colours.map((c) => (
            <span
              key={c.key}
              className="story-part story-stamp flex items-center gap-2 font-sans text-[0.8rem] text-foreground"
              style={at(i++)}
            >
              <span
                className="size-7 rounded-swatch shadow-[0_4px_12px_-4px_rgba(50,32,18,0.3)]"
                style={{
                  backgroundColor: c.face,
                  opacity: c.inStock ? 1 : 0.4,
                }}
              />
              {c.name}
            </span>
          ))}
        </div>
      </div>
      {product.wording.length > 0 ? (
        <div className="mt-6 flex flex-col gap-2">
          <span className={MICRO}>The buyer writes</span>
          {product.wording.map((w) => (
            <p
              key={w.label}
              className="story-part flex items-baseline gap-3 font-sans text-[0.85rem] text-on-surface-mid"
              style={at(i++)}
            >
              {w.label}
              {w.example ? (
                <span className="border-b border-dashed border-primary/50 font-serif text-[1.05rem] italic text-foreground">
                  {w.example}
                </span>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// The sample leaf, filled as a source drawing.
function SampleSource() {
  return (
    <svg viewBox="0 0 100 100" className="size-full" role="img">
      <title>{`${SAMPLE_DESIGN.name}, the source drawing`}</title>
      <rect width="100" height="100" fill={SAMPLE_DESIGN.paper} />
      <path d={SAMPLE_DESIGN.paths[0]} fill={SAMPLE_DESIGN.leaf} />
      {SAMPLE_DESIGN.paths.slice(1).map((d) => (
        <path
          key={d}
          d={d}
          stroke={SAMPLE_DESIGN.vein}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </svg>
  );
}

// Its line art, drawn stroke by stroke; the vector carries its nodes.
function SampleLines({ vector, from }: { vector: boolean; from: number }) {
  return (
    <svg viewBox="0 0 100 100" className="size-full" role="img">
      <title>
        {`${SAMPLE_DESIGN.name}, ${vector ? "traced as a vector" : "drawn as line art"}`}
      </title>
      <rect width="100" height="100" fill="#ffffff" />
      {SAMPLE_DESIGN.paths.map((d, n) => (
        <path
          key={d}
          d={d}
          pathLength={1}
          strokeDasharray={1}
          className="story-part story-draw"
          style={at(from + n)}
          stroke={vector ? "var(--primary)" : "#241f18"}
          strokeWidth={vector ? 1.6 : 2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
      {vector
        ? SAMPLE_DESIGN.paths.map((d, n) => {
            const [x, y] = d
              .slice(1)
              .split(/[\s,C]+/)
              .map(Number);
            return (
              <circle
                key={`node-${d}`}
                cx={x}
                cy={y}
                r={2.2}
                className="story-part story-stamp"
                style={at(from + SAMPLE_DESIGN.paths.length + n, {
                  transformOrigin: `${x}px ${y}px`,
                })}
                fill="#ffffff"
                stroke="var(--primary)"
                strokeWidth={1.2}
              />
            );
          })
        : null}
    </svg>
  );
}

function Panel({
  label,
  note,
  children,
  i,
  wipe = false,
  paper = false,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
  i: number;
  wipe?: boolean;
  // A white ground, so a hairline vector reads.
  paper?: boolean;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div
        className={`story-part ${wipe ? "story-wipe" : ""} aspect-square overflow-hidden rounded-render shadow-render ${paper ? "bg-white" : "bg-surface-soft"}`}
        style={at(i)}
      >
        {children}
      </div>
      <figcaption className="flex flex-col">
        <span className="font-sans text-[0.8rem] font-semibold text-foreground">
          {label}
        </span>
        {note ? (
          <span className="font-mono text-[0.6rem] text-on-surface-mid">
            {note}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

const Img = ({ src }: { src: string }) => (
  // biome-ignore lint/performance/noImgElement: Kiln's own stored drawing, shown as stored
  <img src={src} alt="" loading="lazy" className="size-full object-contain" />
);

// 2. A drawing to SVG: the source, its line art, the traced vector.
export function DesignStage({ design }: { design: StoryDesign | null }) {
  const steps = (
    <>
      <Panel label="Your drawing" note="a sketch or a photo" i={3}>
        {design ? (
          <Img src={design.source ?? design.lineArt} />
        ) : (
          <SampleSource />
        )}
      </Panel>
      <Panel
        label="Line art"
        note="drawn by an image model"
        i={4}
        wipe={Boolean(design)}
      >
        {design ? (
          <Img src={design.lineArt} />
        ) : (
          <SampleLines vector={false} from={5} />
        )}
      </Panel>
      <Panel
        label="SVG"
        note="traced, free"
        i={12}
        wipe={Boolean(design)}
        paper
      >
        {design ? (
          <Img src={design.vector} />
        ) : (
          <SampleLines vector from={13} />
        )}
      </Panel>
    </>
  );
  return (
    <div className={STAGE}>
      <SampleMark shown={!design} />
      <div className="grid grid-cols-3 gap-3 sm:gap-5">{steps}</div>
      <p
        className="story-part mt-5 flex flex-wrap items-center gap-2 font-sans text-[0.8rem] text-on-surface-mid"
        style={at(20)}
      >
        {design && design.name.length <= 40 ? (
          <span className="font-serif italic text-foreground">
            {design.name}
          </span>
        ) : null}
        <span className={`${CHIP} bg-prov-recipe/10 text-prov-recipe`}>
          vector ready for your product
        </span>
      </p>
    </div>
  );
}

const TILTS = ["-4deg", "1.5deg", "5deg"];
const DEALS = ["-64px", "-24px", "24px"];

// 3. Exact frames dealt from the stack, drawn from the spec.
export function ExactStage({
  frames,
  plate,
  sample,
}: {
  frames: StoryFrame[];
  plate: PlateImage | null;
  sample: boolean;
}) {
  return (
    <div className={`${STAGE} bg-surface-soft`}>
      <SampleMark shown={sample} />
      <div className="grid grid-cols-3 items-end gap-3 pt-4 sm:gap-5">
        {frames.map((f, n) => (
          <figure key={f.label} className="flex min-w-0 flex-col gap-2">
            <div
              className="story-part story-deal overflow-hidden rounded-render bg-card shadow-render"
              style={at(3 + n, {
                transform: `rotate(${TILTS[n] ?? "0deg"})`,
                "--tilt": TILTS[n] ?? "0deg",
                "--deal-x": DEALS[n] ?? "0px",
              } as CSSProperties)}
            >
              <ExactSlotArt view={f.view} aspect={f.aspect} plate={plate} />
            </div>
            <figcaption className="truncate font-sans text-[0.75rem] text-on-surface-mid">
              {f.label}
            </figcaption>
          </figure>
        ))}
      </div>
      <p
        className="story-part mt-5 flex flex-wrap gap-2"
        style={at(3 + frames.length)}
      >
        <span className={`${CHIP} bg-prov-recipe/10 text-prov-recipe`}>
          $0 · drawn, not generated
        </span>
        <span className={`${CHIP} bg-surface-soft text-on-surface-mid`}>
          to each channel's size
        </span>
      </p>
    </div>
  );
}

const CHECK_TONE: Record<string, string> = {
  passed: "bg-prov-recipe text-white",
  failed: "bg-prov-local text-white",
  unchecked: "bg-card text-on-surface-mid",
};

// Soft room tones for the scenes to come: linen, terracotta haze, sage, sand.
const BACKDROPS = [
  "radial-gradient(120% 90% at 30% 20%, #f6efe3 0%, #e9dcc6 55%, #d9c6a8 100%)",
  "radial-gradient(110% 90% at 70% 30%, #f3e4d3 0%, #e2c2a3 60%, #c99d78 100%)",
  "radial-gradient(120% 100% at 40% 70%, #eef0e4 0%, #d8dcc4 55%, #b9c0a0 100%)",
  "linear-gradient(160deg, #f4ede2 0%, #e6d8c3 50%, #cdb69a 100%)",
];

// A scene to come, for a maker who has none yet: the product on a warm
// backdrop, never passed off as a photo.
function SceneToCome({ n, product }: { n: number; product: StoryProduct }) {
  const colour = product.colours[0];
  return (
    <div
      className="flex size-full items-center justify-center"
      style={{ background: BACKDROPS[n % BACKDROPS.length] }}
    >
      <div
        className="flex aspect-[8/5] w-[58%] items-center justify-center rounded-[14%/22%] shadow-[0_18px_30px_-12px_rgba(50,32,18,0.45)]"
        style={{ backgroundColor: colour?.face ?? "#E8D2A6" }}
      >
        <span className="px-2 text-center font-serif text-[0.8rem] italic text-[#3b2a1e] opacity-80 sm:text-[0.95rem]">
          {product.wording[0]?.example ?? product.name}
        </span>
      </div>
    </div>
  );
}

const TO_COME = ["In use", "Lifestyle", "Detail", "Gift"];

// 4. Scenes developing, each stamped with its check.
export function ScenesStage({
  scenes,
  product,
}: {
  scenes: StoryScene[];
  product: StoryProduct;
}) {
  const sample = scenes.length === 0;
  const shown: StoryScene[] = sample
    ? TO_COME.map((label) => ({ label, aspect: "4:5", url: "" }))
    : scenes;
  return (
    <div className={STAGE}>
      <SampleMark shown={sample} />
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        {shown.map((s, n) => (
          <figure
            key={`${s.label}-${n}`}
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="relative">
              <div
                className="story-part story-develop overflow-hidden rounded-render bg-surface-soft shadow-render"
                style={at(3 + n, {
                  aspectRatio: s.aspect.replace(":", " / "),
                })}
              >
                {sample ? (
                  <SceneToCome n={n} product={product} />
                ) : (
                  // biome-ignore lint/performance/noImgElement: the maker's approved take, as stored
                  <img
                    src={s.url}
                    alt={s.label}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                )}
              </div>
              {s.check ? (
                <span
                  className={`story-part story-stamp absolute bottom-2 left-2 ${CHIP} shadow-[0_6px_14px_-6px_rgba(50,32,18,0.5)] ${CHECK_TONE[s.check.status] ?? CHECK_TONE.unchecked}`}
                  style={at(8 + n)}
                >
                  {s.check.status === "passed" ? (
                    <Check className="size-3" />
                  ) : null}
                  {s.check.label}
                </span>
              ) : null}
            </div>
            <figcaption className="truncate font-sans text-[0.75rem] text-on-surface-mid">
              {s.label}
            </figcaption>
          </figure>
        ))}
      </div>
      <p
        className="story-part mt-5 flex flex-wrap items-center gap-2 font-sans text-[0.8rem] text-on-surface-mid"
        style={at(12)}
      >
        {sample
          ? "Your scenes appear here, each checked before you see it."
          : null}
        <span className={`${CHIP} bg-surface-soft text-on-surface-mid`}>
          reject with a reason <ArrowRight className="size-3" /> a new take
        </span>
      </p>
    </div>
  );
}

// 6. The listing's words: the title typed, the tags laid down, each count
// against the channel's limit.
export function WordsStage({
  words,
  sample,
}: {
  words: StoryWords;
  sample: boolean;
}) {
  return (
    <div className={STAGE}>
      <SampleMark shown={sample} />
      <p className={MICRO}>{words.channel} listing</p>
      <div className="mt-4 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-4">
          <span className={MICRO}>Title</span>
          <span
            className="story-part font-mono text-[0.65rem] text-prov-recipe"
            style={at(5)}
          >
            {words.title.length}/{words.titleMax}
          </span>
        </div>
        <p
          className="story-part story-wipe font-serif text-[1.25rem] leading-snug text-foreground"
          style={at(3)}
        >
          {words.title}
        </p>
      </div>
      <p
        className="story-part mt-4 line-clamp-4 whitespace-pre-line font-sans text-[0.85rem] leading-relaxed text-on-surface-mid"
        style={at(6)}
      >
        {words.description}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className={MICRO}>Tags</span>
          <span
            className="story-part font-mono text-[0.65rem] text-prov-recipe"
            style={at(8 + words.tags.length)}
          >
            {words.tags.length}/{words.tagMax}
          </span>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {words.tags.map((t, n) => (
            <li
              key={t}
              className="story-part story-stamp rounded-pill bg-surface-soft px-2.5 py-1 font-sans text-[0.75rem] text-foreground"
              style={at(7 + n)}
            >
              {t}
            </li>
          ))}
        </ul>
      </div>
      <p
        className="story-part mt-5 flex flex-wrap gap-2"
        style={at(9 + words.tags.length)}
      >
        <span className={`${CHIP} bg-prov-recipe/10 text-prov-recipe`}>
          <Check className="size-3" /> within {words.channel}'s rules
        </span>
        <span className={`${CHIP} bg-surface-soft text-on-surface-mid`}>
          drafted from the spec, free
        </span>
      </p>
    </div>
  );
}

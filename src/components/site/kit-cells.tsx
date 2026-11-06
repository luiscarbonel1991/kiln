import { Check, MessageSquare, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { at } from "@/components/home/story-part";
import { SampleLines, SampleSource } from "@/components/home/story-stages";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import type { HomeStory, StoryScene } from "@/lib/home-story";

// The eight things Kiln makes for one product, each a cell of the kit's proof
// sheet. The same cells sit beside the steps on a wide screen and under each
// step on a phone; their parts (story-part, at()) follow the scroll there.
// Ancestors of a part clip with overflow-clip, never overflow-hidden, so a part
// keeps the page as its scroller.

const MONO = "font-mono text-[0.6rem] leading-none text-on-surface-dim";
const MICRO =
  "font-sans text-[0.56rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const FRAME = "overflow-clip rounded-[9px] bg-card shadow-render";

function Cell({
  n,
  label,
  className = "",
  children,
}: {
  n: number;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className={`flex min-w-0 flex-col gap-2.5 ${className}`}>
      <figcaption className={MONO}>
        <span className="text-primary">fig. {String(n).padStart(2, "0")}</span>{" "}
        · {label}
      </figcaption>
      {children}
    </figure>
  );
}

const money = (n: number) => `$${n.toFixed(0)}`;

export function SpecCell({ story }: { story: HomeStory }) {
  const p = story.product;
  const facts = [
    p.size,
    p.material,
    p.finish,
    ...(p.price ? [money(p.price)] : []),
  ];
  const word = p.wording[0];
  return (
    <Cell n={1} label="the spec">
      <div className="flex flex-col gap-2">
        <p
          className="story-part font-serif text-[1rem] italic leading-tight text-foreground"
          style={at(2)}
        >
          {p.name}
        </p>
        <p
          className="story-part font-sans text-[0.72rem] leading-snug text-on-surface-mid"
          style={at(3)}
        >
          {facts.join(" · ")}
        </p>
        <div className="flex items-center gap-1.5 pt-0.5">
          {p.colours.map((c, n) => (
            <span
              key={c.key}
              title={c.name}
              className="story-part story-stamp size-4 rounded-[5px] shadow-[0_3px_8px_-3px_rgba(50,32,18,0.4)]"
              style={at(4 + n, { backgroundColor: c.face })}
            />
          ))}
        </div>
        {word?.example ? (
          <p
            className="story-part flex items-baseline gap-2 font-sans text-[0.68rem] text-on-surface-mid"
            style={at(4 + p.colours.length)}
          >
            {word.label}
            <span className="border-b border-dashed border-primary/50 font-serif text-[0.9rem] italic text-foreground">
              {word.example}
            </span>
          </p>
        ) : null}
      </div>
    </Cell>
  );
}

// The drawing develops; its line art and then its vector draw themselves on
// white paper, stroke by stroke.
export function DesignCell() {
  const arrow = (i: number) => (
    <span
      className="story-part font-mono text-[0.7rem] text-on-surface-dim"
      style={at(i)}
      aria-hidden
    >
      →
    </span>
  );
  const panel = (label: string, art: ReactNode, className = "", i?: number) => (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        className={`aspect-square ${FRAME} ${className}`}
        style={i === undefined ? undefined : at(i)}
      >
        {art}
      </div>
      <span className={MONO}>{label}</span>
    </div>
  );
  return (
    <Cell n={2} label="a drawing, as svg">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5">
        {panel("drawing", <SampleSource />, "story-part story-develop", 1)}
        {arrow(2)}
        {panel("line art", <SampleLines vector={false} from={3} />, "bg-white")}
        {arrow(5)}
        {panel("svg", <SampleLines vector from={6} />, "bg-white")}
      </div>
    </Cell>
  );
}

const TILTS = ["-3deg", "1deg", "4deg"];
const DEALS = ["-56px", "-20px", "20px"];

export function ExactCell({ story }: { story: HomeStory }) {
  return (
    <Cell n={3} label="exact frames, drawn from the spec">
      <div className="grid max-w-[300px] grid-cols-3 gap-2.5 pt-1">
        {story.exact.map((f, n) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-1.5">
            <div
              className={`story-part story-deal ${FRAME}`}
              style={at(1 + n, {
                transform: `rotate(${TILTS[n] ?? "0deg"})`,
                "--tilt": TILTS[n] ?? "0deg",
                "--deal-x": DEALS[n] ?? "0px",
              } as CSSProperties)}
            >
              <ExactSlotArt
                view={f.view}
                aspect={f.aspect}
                plate={story.plate}
              />
            </div>
            <span className={`story-part truncate ${MONO}`} style={at(1 + n)}>
              {f.label.toLowerCase()}
            </span>
          </div>
        ))}
      </div>
    </Cell>
  );
}

// A take's check, cut to a word or two; the full reading is its title.
function Stamp({ scene, i }: { scene: StoryScene; i: number }) {
  if (!scene.check) return null;
  const passed = scene.check.status === "passed";
  return (
    <span
      className={`story-part story-stamp absolute bottom-1.5 left-1.5 inline-flex max-w-[calc(100%-0.75rem)] items-center gap-0.5 rounded-pill px-1.5 py-0.5 font-mono text-[0.52rem] shadow-[0_5px_12px_-5px_rgba(50,32,18,0.55)] ${
        passed ? "bg-prov-recipe text-white" : "bg-prov-local text-white"
      }`}
      style={at(i)}
      title={scene.check.label}
    >
      {passed ? (
        <Check className="size-2.5 shrink-0" />
      ) : (
        <X className="size-2.5 shrink-0" />
      )}
      <span className="truncate">{passed ? "checked" : "failed"}</span>
    </span>
  );
}

export function ScenesCell({ story }: { story: HomeStory }) {
  return (
    <Cell n={4} label="scenes, each take checked">
      <div className="grid grid-cols-4 gap-2">
        {story.scenes.map((s, n) => (
          <div key={s.url} className="relative min-w-0">
            <div
              className={`story-part story-develop aspect-[4/5] ${FRAME}`}
              style={at(1 + n)}
            >
              {/* biome-ignore lint/performance/noImgElement: a take Kiln made, served as a fixed file */}
              <img
                src={s.url}
                alt={s.label}
                width={1080}
                height={1350}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </div>
            <Stamp scene={s} i={5 + n} />
          </div>
        ))}
      </div>
    </Cell>
  );
}

export function LooksCell({ story }: { story: HomeStory }) {
  return (
    <Cell n={5} label="every colour">
      <div className="grid grid-cols-3 gap-2">
        {story.looks.slice(0, 3).map((look, n) => (
          <div key={look.key} className="flex min-w-0 flex-col gap-1.5">
            <div className={`story-part story-wipe ${FRAME}`} style={at(1 + n)}>
              <ExactSlotArt view={look.view} aspect="1:1" />
            </div>
            <span
              className={`story-part flex items-center gap-1 ${MONO}`}
              style={at(1 + n)}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: look.face }}
              />
              {look.name.toLowerCase()}
            </span>
          </div>
        ))}
      </div>
    </Cell>
  );
}

const SHOWN_TAGS = 4;

export function WordsCell({ story }: { story: HomeStory }) {
  const words = story.words;
  if (!words) return null;
  return (
    <Cell n={6} label={`the words, held to ${words.channel}'s rules`}>
      <div
        className="story-part story-wipe flex flex-col gap-2 rounded-[9px] bg-surface-soft p-3"
        style={at(0)}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className={`story-part ${MICRO}`} style={at(1)}>
            Title
          </span>
          <span
            className="story-part font-mono text-[0.58rem] text-prov-recipe"
            style={at(2)}
          >
            {words.title.length}/{words.titleMax}
          </span>
        </div>
        <p
          className="story-part story-wipe font-serif text-[0.9rem] leading-snug text-foreground"
          style={at(1)}
        >
          {words.title}
        </p>
        <div className="flex items-baseline justify-between gap-3 pt-1">
          <span className={`story-part ${MICRO}`} style={at(3)}>
            Tags
          </span>
          <span
            className="story-part font-mono text-[0.58rem] text-prov-recipe"
            style={at(3 + SHOWN_TAGS)}
          >
            {words.tags.length}/{words.tagMax}
          </span>
        </div>
        <ul className="flex flex-wrap gap-1">
          {words.tags.slice(0, SHOWN_TAGS).map((t, n) => (
            <li
              key={t}
              className="story-part story-stamp rounded-pill bg-card px-2 py-0.5 font-sans text-[0.62rem] text-foreground"
              style={at(3 + n)}
            >
              {t}
            </li>
          ))}
          {words.tags.length > SHOWN_TAGS ? (
            <li
              className="story-part px-1 py-0.5 font-mono text-[0.58rem] text-on-surface-dim"
              style={at(3 + SHOWN_TAGS)}
            >
              +{words.tags.length - SHOWN_TAGS}
            </li>
          ) : null}
        </ul>
      </div>
    </Cell>
  );
}

const ratio = (aspect: string) => {
  const [w, h] = aspect.split(":").map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : "1 / 1";
};

// The same take in every shape the channels ask for.
export function ChannelsCell({ story }: { story: HomeStory }) {
  const lead = story.scenes[0];
  const shapes = ["1:1", "4:5", "9:16"];
  const where = (aspect: string) =>
    story.destinations
      .filter((d) => d.aspects.includes(aspect))
      .map((d) => d.name.toLowerCase())
      .join(" · ");
  return (
    <Cell n={7} label="every channel, sized">
      <div className="flex items-end gap-2.5">
        {shapes.map((aspect, n) => (
          <div key={aspect} className="flex min-w-0 flex-col gap-1">
            <div
              className={`story-part story-wipe h-[72px] ${FRAME}`}
              style={at(1 + n, { aspectRatio: ratio(aspect) })}
            >
              {lead ? (
                // biome-ignore lint/performance/noImgElement: a take Kiln made, served as a fixed file
                <img
                  src={lead.url}
                  alt=""
                  width={1080}
                  height={1080}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              ) : null}
            </div>
            <span className={`story-part ${MONO}`} style={at(1 + n)}>
              {aspect}
            </span>
          </div>
        ))}
        <ul className="flex min-w-0 flex-1 flex-col gap-1 pb-4 pl-1">
          {shapes.map((aspect, n) => (
            <li
              key={aspect}
              className="story-part truncate font-mono text-[0.58rem] text-on-surface-mid"
              style={at(4 + n)}
            >
              <span className="text-foreground">{aspect}</span> {where(aspect)}
            </li>
          ))}
          <li
            className="story-part truncate font-mono text-[0.58rem] text-on-surface-mid"
            style={at(7)}
          >
            <span className="text-foreground">zip</span> anywhere else
          </li>
        </ul>
      </div>
    </Cell>
  );
}

export function PublishCell() {
  return (
    <Cell n={8} label="you publish">
      <div className="flex flex-col gap-2">
        <p
          className="story-part flex items-center gap-1.5 self-end rounded-[12px] rounded-br-[4px] bg-surface-soft px-2.5 py-1.5 font-sans text-[0.68rem] text-foreground"
          style={at(1)}
        >
          <MessageSquare className="size-3 text-on-surface-mid" />
          Send this to my shop as a draft.
        </p>
        <div
          className="story-part story-stamp flex flex-col gap-1.5 self-start rounded-[12px] rounded-bl-[4px] bg-card px-3 py-2 shadow-card"
          style={at(2)}
        >
          <span className="font-sans text-[0.52rem] font-bold uppercase tracking-[0.16em] text-prov-brand">
            Waits for your ok
          </span>
          <span className="font-sans text-[0.68rem] leading-snug text-foreground">
            A draft from this kit: text, photos, price.
          </span>
          <span className="flex gap-1.5" aria-hidden>
            <span className="inline-flex items-center gap-1 rounded-[8px] bg-primary px-2 py-0.5 font-sans text-[0.62rem] font-semibold text-primary-foreground">
              <Check className="size-2.5" /> Approve
            </span>
            <span className="inline-flex items-center rounded-[8px] px-2 py-0.5 font-sans text-[0.62rem] font-semibold text-on-surface-mid">
              Not now
            </span>
          </span>
        </div>
      </div>
    </Cell>
  );
}

// A printer's crop marks at a print's corners.
export function CropMarks() {
  const mark = "pointer-events-none absolute size-4 border-on-surface-dim/60";
  return (
    <span aria-hidden>
      <span className={`${mark} -top-3 -left-3 border-t border-l`} />
      <span className={`${mark} -top-3 -right-3 border-t border-r`} />
      <span className={`${mark} -bottom-3 -left-3 border-b border-l`} />
      <span className={`${mark} -right-3 -bottom-3 border-r border-b`} />
    </span>
  );
}

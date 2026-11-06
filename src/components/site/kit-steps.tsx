import type { CSSProperties, ReactNode } from "react";
import {
  ChannelsCell,
  CropMarks,
  DesignCell,
  ExactCell,
  LooksCell,
  PublishCell,
  ScenesCell,
  SpecCell,
  WordsCell,
} from "@/components/site/kit-cells";
import type { HomeStory } from "@/lib/home-story";

// What Kiln makes for one product, as eight steps. On a wide screen the kit's
// proof sheet stays beside them and fills cell by cell, each cell following
// its step's view timeline (landing.css); on a phone each step shows its cell
// beneath it. Without scroll timelines, or with reduced motion, every cell
// simply shows.

type Tone = "free" | "paid" | "plain";

interface Step {
  eyebrow: string;
  title: string;
  body: ReactNode;
  tags: { label: string; tone: Tone }[];
  cell: ReactNode;
  // Where the cell sits on the sheet's five columns.
  span: string;
}

const TONE: Record<Tone, string> = {
  free: "text-prov-recipe before:bg-prov-recipe",
  paid: "text-prov-brand before:bg-prov-brand",
  plain: "text-on-surface-mid before:bg-on-surface-dim",
};

const timeline = (n: number) => ({ "--kit-tl": `--kit-${n}` }) as CSSProperties;

function steps(story: HomeStory): Step[] {
  const words = story.words;
  return [
    {
      eyebrow: "The spec",
      title: "Your product, kept in one place.",
      body: "Size, material, finish, colours, what the buyer personalizes and the price. Everything Kiln makes is drawn from it.",
      tags: [{ label: "free", tone: "free" }],
      cell: <SpecCell story={story} />,
      span: "col-span-2",
    },
    {
      eyebrow: "Designs",
      title: "A drawing becomes a clean SVG.",
      body: "An image model redraws a sketch or a photo as line art, and Kiln traces it into a vector you can build a product on.",
      tags: [
        { label: "line art · image model", tone: "paid" },
        { label: "svg · free", tone: "free" },
      ],
      cell: <DesignCell />,
      span: "col-span-2",
    },
    {
      eyebrow: "Exact frames",
      title: "Frames drawn from the spec, not guessed.",
      body: "Colour options, size and scale, drawn from your own numbers at every channel's size.",
      tags: [{ label: "free", tone: "free" }],
      cell: <ExactCell story={story} />,
      span: "col-span-3",
    },
    {
      eyebrow: "Scenes",
      title: "Scenes only a photo can show, each take checked.",
      body: (
        <>
          An image model sets the scene around your product, and Kiln reads
          every take's letters against it before you see one. Here the detail
          failed: its letters came out thinner than the reference.
        </>
      ),
      tags: [{ label: "image model · priced before it runs", tone: "paid" }],
      cell: <ScenesCell story={story} />,
      span: "col-span-3",
    },
    {
      eyebrow: "Every colour",
      title: "Every colour, without a reshoot.",
      body: "Add a colour and every frame redraws itself in it.",
      tags: [{ label: "free", tone: "free" }],
      cell: <LooksCell story={story} />,
      span: "col-span-2",
    },
    {
      eyebrow: "The words",
      title: words
        ? `Listing text, held to ${words.channel}'s rules.`
        : "Listing text, held to each channel's rules.",
      body: "Title, description and tags drafted from the spec and counted against the channel's limits. A text model rewrites them when you ask.",
      tags: [{ label: "draft · free", tone: "free" }],
      cell: <WordsCell story={story} />,
      span: "col-span-3",
    },
    {
      eyebrow: "Every channel",
      title: "One kit, every place it sells.",
      body: "Sized for Etsy, Instagram and Amazon, a zip for anywhere else, a draft straight into your shop, and its numbers read back 30 days later.",
      tags: [{ label: "free", tone: "free" }],
      cell: <ChannelsCell story={story} />,
      span: "col-span-3",
    },
    {
      eyebrow: "You publish",
      title: "Kiln proposes. You publish.",
      body: "Ask in words: Kiln's agents read your work and propose. Anything paid or sent waits for your ok.",
      tags: [{ label: "nothing goes out without your click", tone: "plain" }],
      cell: <PublishCell />,
      span: "col-span-2",
    },
  ];
}

// The sheet's order: zig-zag rows of two cells, so it reads as one page.
const SHEET_ORDER = [0, 3, 2, 1, 4, 5, 6, 7];

export function KitSteps({ story }: { story: HomeStory }) {
  const all = steps(story);
  return (
    <section
      id="kit"
      aria-labelledby="kit-title"
      className="flex scroll-mt-24 flex-col gap-12 lg:gap-16"
    >
      <header className="flex max-w-[640px] flex-col gap-3">
        <p className="font-mono text-[0.68rem] text-primary">What it makes</p>
        <h2
          id="kit-title"
          className="font-serif text-[2.1rem] font-semibold leading-[1.08] text-foreground sm:text-[2.8rem]"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          One product, its whole kit.
        </h2>
        <p className="font-sans text-[0.9375rem] leading-relaxed text-on-surface-mid">
          Shown with a sample cutting board: its photos, frames and listing text
          are what Kiln made for it.
        </p>
      </header>

      <div className="kit-track grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:gap-16">
        <ol className="kit-steps flex flex-col gap-16 lg:gap-0">
          {all.map((s, n) => (
            <li
              key={s.eyebrow}
              className="kit-step flex flex-col gap-6 lg:justify-center"
              style={timeline(n + 1)}
              data-testid={`kit-step-${n + 1}`}
            >
              <div className="kit-step-copy flex flex-col gap-3">
                <p className="flex items-baseline gap-3 font-mono text-[0.68rem] text-on-surface-mid">
                  <span className="text-primary">
                    {String(n + 1).padStart(2, "0")}
                  </span>
                  {s.eyebrow}
                </p>
                <h3
                  className="font-serif text-[1.6rem] font-semibold leading-[1.12] text-foreground sm:text-[1.85rem]"
                  style={{ fontVariationSettings: "'opsz' 144" }}
                >
                  {s.title}
                </h3>
                <p className="max-w-[440px] font-sans text-[0.9375rem] leading-relaxed text-on-surface-mid">
                  {s.body}
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
                  {s.tags.map((t) => (
                    <span
                      key={t.label}
                      className={`inline-flex items-center gap-1.5 font-mono text-[0.65rem] before:size-1.5 before:rounded-full before:content-[''] ${TONE[t.tone]}`}
                    >
                      {t.label}
                    </span>
                  ))}
                </p>
              </div>
              <div className="kit-inline rounded-card bg-card p-4 shadow-card lg:hidden">
                {s.cell}
              </div>
            </li>
          ))}
        </ol>

        <div className="kit-sheet-wrap hidden self-start lg:block lg:[@media(min-height:720px)]:sticky lg:[@media(min-height:720px)]:top-20">
          <div className="kit-sheet relative rounded-card bg-card px-6 pt-5 pb-6 shadow-card">
            <CropMarks />
            <div className="flex items-baseline justify-between gap-4 font-mono text-[0.6rem] text-on-surface-dim">
              <span className="truncate">
                {story.product.sku} — {story.product.name.toLowerCase()}
              </span>
              <span className="shrink-0">proof · one product's kit</span>
            </div>
            <div className="relative mt-3 mb-4 h-px bg-border">
              <div className="kit-rail absolute inset-0 origin-left bg-primary" />
            </div>
            <div className="grid grid-cols-5 gap-x-6 gap-y-4">
              {SHEET_ORDER.map((n) => (
                <div
                  key={all[n].eyebrow}
                  className={`kit-cell min-w-0 ${all[n].span}`}
                  style={timeline(n + 1)}
                >
                  {all[n].cell}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

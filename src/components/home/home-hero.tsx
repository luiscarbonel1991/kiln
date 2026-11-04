import { ArrowDown, ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import type { HomeStory } from "@/lib/home-story";

// Home's opening: what Kiln is for in one line, one way in, and the story's
// product rising into place: the page's one entrance.
export function HomeHero({
  story,
  eyebrow,
  next,
}: {
  story: HomeStory;
  eyebrow: string;
  // A returning maker's way back in; a first visit adds a product.
  next: { href: string; label: string } | null;
}) {
  const frames: { key: string; node: ReactNode }[] = [];
  const lead = story.scenes[0];
  if (lead) {
    frames.push({
      key: lead.url,
      node: (
        // biome-ignore lint/performance/noImgElement: the maker's approved take, as stored
        <img src={lead.url} alt="" className="size-full object-cover" />
      ),
    });
  }
  for (const f of story.exact) {
    if (frames.length >= 3) break;
    frames.push({
      key: f.label,
      node: <ExactSlotArt view={f.view} aspect="1:1" plate={story.plate} />,
    });
  }
  const rise = (i: number) => ({ animationDelay: `${i * 90}ms` });
  return (
    <section className="grid grid-cols-1 items-center gap-12 pt-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16 lg:pt-10">
      <div className="flex flex-col gap-5">
        <p
          className="animate-hero-rise font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand"
          style={rise(0)}
        >
          {eyebrow}
        </p>
        <h1
          className="animate-hero-rise font-serif text-[2.4rem] font-semibold leading-[1.04] text-foreground sm:text-[3.4rem]"
          style={{ ...rise(1), fontVariationSettings: "'opsz' 144" }}
        >
          Everything your product needs{" "}
          <span className="italic text-primary">before the sale.</span>
        </h1>
        <p
          className="animate-hero-rise max-w-[520px] font-sans text-[1rem] leading-relaxed text-on-surface-mid"
          style={rise(2)}
        >
          Photos, SVG designs, listing text and every frame each channel asks
          for: made from your product, checked before you see them, and kept in
          a project you keep improving.
        </p>
        <div
          className="animate-hero-rise flex flex-wrap items-center gap-3 pt-1"
          style={rise(3)}
        >
          <Link
            href={next?.href ?? "/projects/new"}
            data-testid="home-next"
            className="inline-flex h-10 items-center gap-2 rounded-field bg-primary px-4 font-sans text-[0.875rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
          >
            {next ? (
              <>
                {next.label} <ArrowRight className="size-4" />
              </>
            ) : (
              <>
                <Plus className="size-4" /> Add your first product
              </>
            )}
          </Link>
          <a
            href="#story"
            className="inline-flex h-10 items-center gap-2 rounded-field px-3 font-sans text-[0.875rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
          >
            See how it works <ArrowDown className="size-4" />
          </a>
        </div>
      </div>
      <div
        className="relative mx-auto h-[300px] w-full max-w-[420px] sm:h-[380px]"
        aria-hidden
      >
        {frames.map((f, n) => (
          <div
            key={f.key}
            className="animate-hero-rise absolute overflow-hidden rounded-render bg-card shadow-render"
            style={{
              ...rise(3 + n),
              ...HERO_FRAME[n],
            }}
          >
            <div className="size-full [&_svg]:size-full">{f.node}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Where each of the three frames sits in the hero's stack, and its tilt.
const HERO_FRAME: React.CSSProperties[] = [
  {
    left: "12%",
    top: "4%",
    width: "64%",
    aspectRatio: "1 / 1",
    rotate: "-3deg",
    zIndex: 3,
  },
  {
    right: "0%",
    top: "34%",
    width: "42%",
    aspectRatio: "1 / 1",
    rotate: "5deg",
    zIndex: 2,
  },
  {
    left: "0%",
    bottom: "0%",
    width: "38%",
    aspectRatio: "1 / 1",
    rotate: "-7deg",
    zIndex: 1,
  },
];

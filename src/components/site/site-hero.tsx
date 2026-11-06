import { ArrowDown, Check } from "lucide-react";
import Link from "next/link";
import { CropMarks } from "@/components/site/kit-cells";
import type { StoryScene } from "@/lib/home-story";
import { GET_STARTED } from "@/lib/site";

const rise = (i: number) => ({ animationDelay: `${i * 90}ms` });

// The public page's opening: what Kiln is for, one way in, and one take Kiln
// made, printed with its check. The page's one entrance; the print eases back
// as it scrolls away (landing.css).
export function SiteHero({ lead }: { lead: StoryScene | undefined }) {
  return (
    <section className="flex flex-col gap-14 lg:gap-20">
      <div className="grid grid-cols-1 items-center gap-12 pt-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16 lg:pt-14">
        <div className="flex flex-col gap-6">
          <p
            className="animate-hero-rise font-mono text-[0.68rem] text-primary"
            style={rise(0)}
          >
            For makers, before the sale
          </p>
          <h1
            className="animate-hero-rise font-serif text-[2.6rem] font-semibold leading-[1.02] text-foreground sm:text-[4rem]"
            style={{ ...rise(1), fontVariationSettings: "'opsz' 144" }}
          >
            Everything your product needs{" "}
            <span className="italic text-primary">before the sale.</span>
          </h1>
          <p
            className="animate-hero-rise max-w-[520px] font-sans text-[1.05rem] leading-relaxed text-on-surface-mid"
            style={rise(2)}
          >
            Photos, SVG designs, listing text and every frame each channel asks
            for: made from your product, checked before you see them, and kept
            in a project you keep improving.
          </p>
          <div
            className="animate-hero-rise flex flex-wrap items-center gap-3 pt-1"
            style={rise(3)}
          >
            <Link
              href={GET_STARTED.href}
              data-testid="site-start-hero"
              className="inline-flex h-11 items-center rounded-field bg-primary px-5 font-sans text-[0.9rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
            >
              {GET_STARTED.label}
            </Link>
            <a
              href="#kit"
              className="inline-flex h-11 items-center gap-2 rounded-field px-3 font-sans text-[0.9rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
            >
              See what it makes <ArrowDown className="size-4" />
            </a>
          </div>
        </div>

        {lead ? (
          <figure
            className="animate-hero-rise relative mx-auto w-full max-w-[420px]"
            style={rise(4)}
          >
            <div className="kit-hero-print relative">
              <CropMarks />
              <div className="rounded-render bg-white p-2.5 shadow-render">
                {/* biome-ignore lint/performance/noImgElement: a take Kiln made, served as a fixed file */}
                <img
                  src={lead.url}
                  alt={`${lead.label} of the sample cutting board, made by Kiln`}
                  width={1080}
                  height={1080}
                  fetchPriority="high"
                  decoding="async"
                  className="aspect-square w-full rounded-[11px] object-cover"
                />
              </div>
              {lead.check ? (
                <span className="absolute -bottom-3.5 left-5 inline-flex max-w-[calc(100%-2.5rem)] -rotate-2 items-center gap-1 rounded-pill bg-prov-recipe px-2.5 py-1 font-mono text-[0.625rem] text-white shadow-[0_6px_14px_-6px_rgba(50,32,18,0.5)]">
                  <Check className="size-3 shrink-0" />
                  <span className="truncate">{lead.check.label}</span>
                </span>
              ) : null}
            </div>
            <figcaption className="mt-8 font-mono text-[0.62rem] text-on-surface-dim">
              <span className="text-primary">fig. 00</span> · sample product ·{" "}
              {lead.label.toLowerCase()}, made by Kiln
            </figcaption>
          </figure>
        ) : null}
      </div>

      <p className="flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-baseline sm:gap-8">
        <span className="shrink-0 font-mono text-[0.68rem] text-on-surface-dim">
          Who it's for
        </span>
        <span className="font-serif text-[1.2rem] italic leading-snug text-foreground sm:text-[1.35rem]">
          Makers who sell what they make: on Etsy, Instagram, Amazon, or
          anywhere a zip goes.
        </span>
      </p>
    </section>
  );
}

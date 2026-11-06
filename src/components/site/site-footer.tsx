import Link from "next/link";
import { GET_STARTED } from "@/lib/site";

// The close of the public page: one way in.
export function SiteClose() {
  return (
    <section className="flex flex-col items-start gap-5 border-t border-border pt-14 sm:items-center sm:text-center">
      <h2
        className="font-serif text-[2.4rem] font-semibold leading-[1.04] text-foreground sm:text-[3.4rem]"
        style={{ fontVariationSettings: "'opsz' 144" }}
      >
        Start with <span className="italic text-primary">one product.</span>
      </h2>
      <p className="max-w-[460px] font-sans text-[0.9375rem] leading-relaxed text-on-surface-mid">
        Type it in, start from a photo or a design file, or import your catalog.
        Nothing is paid without your ok.
      </p>
      <Link
        href={GET_STARTED.href}
        data-testid="site-start-close"
        className="inline-flex h-11 items-center rounded-field bg-primary px-5 font-sans text-[0.9rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
      >
        {GET_STARTED.label}
      </Link>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border-soft">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-2 px-4 py-8 font-mono text-[0.62rem] text-on-surface-dim sm:flex-row sm:justify-between sm:px-8">
        <span>
          <span className="font-serif text-[0.95rem] italic text-foreground">
            kiln<span className="text-primary">.</span>
          </span>{" "}
          everything your product needs before the sale
        </span>
        <span>the sample's scenes were made by Kiln on 2026-11-03</span>
      </div>
    </footer>
  );
}

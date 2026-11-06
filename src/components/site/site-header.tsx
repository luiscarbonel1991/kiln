import Link from "next/link";
import { GET_STARTED } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-soft bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-6 px-4 py-3.5 sm:px-8">
        <Link
          href="/welcome"
          className="font-serif text-2xl italic leading-none text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          kiln<span className="text-primary">.</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-5">
          <a
            href="#kit"
            className="hidden font-sans text-[0.8125rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground sm:inline"
          >
            What it makes
          </a>
          <a
            href="#pricing"
            className="hidden font-sans text-[0.8125rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground sm:inline"
          >
            Pricing
          </a>
          <Link
            href={GET_STARTED.href}
            data-testid="site-start-header"
            className="inline-flex h-9 items-center rounded-field bg-foreground px-3.5 font-sans text-[0.8125rem] font-semibold text-background transition-colors hover:bg-foreground/85"
          >
            {GET_STARTED.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}

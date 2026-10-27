import { Palette, Plus, Settings2, Store } from "lucide-react";
import Link from "next/link";

// Header for Home and the project pages: the wordmark (Home), the studio,
// Shops, Settings and a "New project" entry. Same chrome as the studio header
// (DESIGN.md).
export function ProjectsHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between border-b border-border-soft bg-card/70 px-6 py-4 backdrop-blur-md sm:px-8">
      <div className="flex items-center gap-5">
        <Link
          href="/"
          className="font-serif text-2xl italic leading-none text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          kiln<span className="text-primary">.</span>
        </Link>
        {children}
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/studio"
          className="inline-flex h-7 items-center gap-1 rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <Palette className="size-3.5" /> Studio
        </Link>
        <Link
          href="/shops"
          className="inline-flex h-7 items-center gap-1 rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <Store className="size-3.5" /> Shops
        </Link>
        <Link
          href="/settings"
          className="inline-flex h-7 items-center gap-1 rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <Settings2 className="size-3.5" /> Settings
        </Link>
        <Link
          href="/projects/new"
          className="inline-flex h-7 items-center gap-1 rounded-field bg-primary px-2.5 font-sans text-[0.8rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
        >
          <Plus className="size-3.5" /> New project
        </Link>
      </div>
    </header>
  );
}

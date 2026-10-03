import { Plus } from "lucide-react";
import Link from "next/link";

// Header for the project pages: the wordmark (home = the studio), the studio
// and a "New project" entry. Same chrome as the studio header (DESIGN.md).
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
      <Link
        href="/projects/new"
        className="inline-flex h-7 items-center gap-1 rounded-field bg-primary px-2.5 font-sans text-[0.8rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
      >
        <Plus className="size-3.5" /> New project
      </Link>
    </header>
  );
}

import { MessageCircle, Palette, Plus, Settings2, Store } from "lucide-react";
import Link from "next/link";

// Header for the project pages: the wordmark (the maker's projects), the chat, the
// studio, Shops, Settings and a "New project" entry. Same chrome as the
// studio header. On a project the chat opens beside its board (`chatHref`).
export function ProjectsHeader({
  children,
  chatHref = "/chat",
}: {
  children?: React.ReactNode;
  chatHref?: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border-soft bg-card/70 px-6 py-4 backdrop-blur-md sm:px-8">
      <div className="flex items-center gap-5">
        <Link
          href="/projects"
          className="font-serif text-2xl italic leading-none text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          kiln<span className="text-primary">.</span>
        </Link>
        {children}
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <Link
          href={chatHref}
          scroll={false}
          aria-label="Chat"
          data-testid="header-chat"
          className="inline-flex h-7 items-center gap-1 rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <MessageCircle className="size-3.5" />
          <span className="hidden sm:inline">Chat</span>
        </Link>
        <Link
          href="/studio"
          aria-label="Studio"
          className="inline-flex h-7 items-center gap-1 rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <Palette className="size-3.5" />
          <span className="hidden sm:inline">Studio</span>
        </Link>
        <Link
          href="/shops"
          aria-label="Shops"
          className="inline-flex h-7 items-center gap-1 rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <Store className="size-3.5" />
          <span className="hidden sm:inline">Shops</span>
        </Link>
        <Link
          href="/settings"
          aria-label="Settings"
          className="inline-flex h-7 items-center gap-1 rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
        >
          <Settings2 className="size-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Link>
        <Link
          href="/projects/new"
          aria-label="New project"
          className="inline-flex h-7 items-center gap-1 rounded-field bg-primary px-2.5 font-sans text-[0.8rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
        >
          <Plus className="size-3.5" />
          <span className="hidden min-[400px]:inline">New project</span>
        </Link>
      </div>
    </header>
  );
}

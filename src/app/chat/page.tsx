import { Plus } from "lucide-react";
import Link from "next/link";
import { MakerChat } from "@/components/chat/maker-chat";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { cn } from "@/lib/utils";
import { listChatSessions } from "@/server/chat/chat-repository";
import { chatPanelData } from "@/server/chat/chat-view";
import { requireMaker } from "@/server/session";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Chat: the maker's conversations with Kiln's agent, their own and each
// project's, newest first; one open beside them. `?session=` opens one; none
// opens a new conversation of the maker's own.
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  await requireMaker();
  const { session } = await searchParams;
  const sessions = await listChatSessions();
  const open = sessions.find((s) => s.id === session) ?? null;
  const data = await chatPanelData(open ? { sessionId: open.id } : {});
  const title = open
    ? open.projectName
      ? `${open.projectName} · ${open.title}`
      : open.title
    : "A new conversation";
  return (
    <div className="flex h-dvh flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          chat
        </span>
      </ProjectsHeader>
      <main className="mx-auto grid min-h-0 w-full max-w-[1100px] flex-1 grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[280px_1fr]">
        <nav
          aria-label="Conversations"
          className="hidden min-h-0 flex-col gap-2 overflow-y-auto lg:flex"
        >
          <Link
            href="/chat"
            data-testid="chat-page-new"
            className="inline-flex h-8 items-center gap-1.5 self-start rounded-field px-2.5 font-sans text-[0.8rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
          >
            <Plus className="size-3.5" />
            New conversation
          </Link>
          {sessions.length === 0 ? (
            <p className="px-2.5 font-sans text-[0.78rem] text-on-surface-mid">
              No conversations yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/chat?session=${s.id}`}
                    data-testid={`chat-session-${s.id}`}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-field px-3 py-2 transition-colors hover:bg-secondary",
                      s.id === open?.id && "bg-card shadow-card",
                    )}
                  >
                    <span className="truncate font-sans text-[0.8rem] font-semibold text-foreground">
                      {s.title}
                    </span>
                    <span className="flex items-center gap-1.5 font-mono text-[0.6rem] text-on-surface-dim">
                      {s.running ? (
                        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                      ) : null}
                      {s.projectName ?? "your own"} · {when(s.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="min-h-0 overflow-hidden rounded-card shadow-card">
          <MakerChat key={open?.id ?? "new"} data={data} title={title} />
        </div>
      </main>
    </div>
  );
}

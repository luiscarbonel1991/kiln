"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { ArrowUp, Loader2, Plus, Square, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createChatAction } from "@/app/actions/chat";
import { ChatMessage, money } from "@/components/chat/chat-parts";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ChatEstimate, ChatPanelData } from "@/server/chat/chat-view";
import type { KilnMessage } from "@/server/chat/messages";

// Kiln's chat (ROADMAP "Agents", stage 2): a project's conversation beside
// its board, or one of the maker's own on the Chat page. The maker writes;
// the agent works through Kiln's tools and asks for a click before anything
// that spends, approves a frame or makes the delivery. A conversation is
// made on the first message; one whose turn is still running (after a
// reload) is read from Kiln until the turn ends.

const SUGGESTIONS = {
  project: [
    "How are the frames?",
    "Generate the waiting scenes",
    "Write the Etsy listing",
  ],
  maker: ["Which projects need me?", "List my products"],
};

type Pending = { text: string; plan: boolean };

export function ChatPanel({
  data,
  projectId,
  title,
  closeHref,
  onSession,
}: {
  data: ChatPanelData;
  projectId?: string;
  title: string;
  closeHref?: string;
  onSession?: (id: string) => void;
}) {
  const [sessionId, setSessionId] = useState(data.sessionId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const fresh = sessionId === null;

  const start = (first: Pending) =>
    startTransition(async () => {
      setError(null);
      const made = await createChatAction(projectId ? { projectId } : {});
      if ("error" in made) {
        setError(made.error);
        return;
      }
      setPending(first);
      setSessionId(made.id);
      onSession?.(made.id);
    });

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-card"
      data-testid="chat-panel"
      aria-label="Chat"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border-soft px-4 py-3">
        <div className="min-w-0">
          <div className="font-sans text-[0.6rem] font-bold tracking-[0.18em] text-prov-brand uppercase">
            Chat
          </div>
          <div
            className="truncate font-serif text-base text-foreground italic"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            {title}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!fresh ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid="chat-new"
              onClick={() => {
                setPending(null);
                setSessionId(null);
              }}
            >
              <Plus />
              New
            </Button>
          ) : null}
          {closeHref ? (
            <Link
              href={closeHref}
              scroll={false}
              aria-label="Close the chat"
              data-testid="chat-close"
              className="inline-flex size-7 items-center justify-center rounded-field text-on-surface-mid transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </Link>
          ) : null}
        </div>
      </header>
      {sessionId ? (
        <Conversation
          key={sessionId}
          sessionId={sessionId}
          initial={sessionId === data.sessionId ? data.messages : []}
          running={sessionId === data.sessionId && data.running}
          estimates={data.estimates}
          toolTitles={data.toolTitles}
          first={pending}
          refreshBoard={projectId !== undefined}
        />
      ) : (
        <>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p
              className="font-serif text-lg text-foreground italic"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              Ask Kiln to do the work.
            </p>
            <p className="max-w-[260px] font-sans text-[0.78rem] text-on-surface-mid">
              It reads and plans on its own, and asks you before anything that
              spends, approves or delivers.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS[projectId ? "project" : "maker"].map((s, i) => (
                <button
                  key={s}
                  type="button"
                  disabled={starting}
                  data-testid={`chat-suggestion-${i + 1}`}
                  onClick={() => start({ text: s, plan: false })}
                  className="rounded-pill border border-border-soft bg-secondary px-3 py-1 font-sans text-xs text-on-surface-mid transition-colors hover:border-primary"
                >
                  {s}
                </button>
              ))}
            </div>
            {error ? (
              <p className="font-sans text-[0.75rem] text-prov-local">
                {error}
              </p>
            ) : null}
          </div>
          <Composer
            estimates={data.estimates}
            busy={starting}
            onSend={(text, plan) => start({ text, plan })}
          />
        </>
      )}
    </section>
  );
}

function Conversation({
  sessionId,
  initial,
  running,
  estimates,
  toolTitles,
  first,
  refreshBoard,
}: {
  sessionId: string;
  initial: KilnMessage[];
  running: boolean;
  estimates: ChatPanelData["estimates"];
  toolTitles: Record<string, string>;
  first: Pending | null;
  refreshBoard: boolean;
}) {
  const router = useRouter();
  const plan = useRef(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<KilnMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { sessionId: id, message: messages.at(-1), plan: plan.current },
        }),
      }),
    [],
  );
  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
    setMessages,
    addToolApprovalResponse,
  } = useChat<KilnMessage>({
    id: sessionId,
    messages: initial,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      if (refreshBoard) router.refresh();
    },
  });

  // A turn that was running before this page loaded: read the stored
  // conversation until it ends.
  const [catchingUp, setCatchingUp] = useState(running);
  useEffect(() => {
    if (!catchingUp) return;
    let alive = true;
    const read = async () => {
      const response = await fetch(`/api/chat/${sessionId}`, {
        cache: "no-store",
      }).catch(() => null);
      if (!alive || !response?.ok) return;
      const chat = (await response.json()) as {
        running: boolean;
        messages: KilnMessage[];
      };
      setMessages(chat.messages);
      if (!chat.running) {
        setCatchingUp(false);
        if (refreshBoard) router.refresh();
      }
    };
    void read();
    const timer = setInterval(read, 2_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [catchingUp, sessionId, setMessages, refreshBoard, router]);

  // The message that made the conversation, sent once it is open (a timer,
  // so a remount in development does not lose or repeat it).
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!first || sentFirst.current) return;
    const timer = setTimeout(() => {
      sentFirst.current = true;
      plan.current = first.plan;
      void sendMessage({ text: first.text });
    }, 0);
    return () => clearTimeout(timer);
  }, [first, sendMessage]);

  const working = status === "submitted" || status === "streaming";
  const busy = working || catchingUp;

  const stopTurn = async () => {
    await fetch(`/api/chat/${sessionId}/stop`, { method: "POST" }).catch(
      () => null,
    );
    stop();
    setCatchingUp(true);
  };

  return (
    <>
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport aria-label="The conversation">
            <MessageScrollerContent className="gap-4 px-4 py-4">
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessage
                    message={message}
                    messages={messages}
                    toolTitles={toolTitles}
                    busy={busy}
                    onAnswer={(id, approved) => {
                      plan.current = false;
                      addToolApprovalResponse({ id, approved });
                    }}
                  />
                </MessageScrollerItem>
              ))}
              {busy ? (
                <div className="flex items-center gap-2 font-mono text-[0.68rem] text-on-surface-dim">
                  <Loader2 className="size-3 animate-spin" />
                  {catchingUp ? "a turn is still running" : "working"}
                </div>
              ) : null}
              {error ? (
                <div className="flex items-start justify-between gap-3 rounded-field bg-prov-local/10 px-3 py-2">
                  <span className="font-sans text-[0.78rem] text-prov-local">
                    {error.message}
                  </span>
                  <button
                    type="button"
                    className="font-sans text-[0.72rem] font-semibold text-on-surface-mid hover:text-foreground"
                    onClick={clearError}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <Composer
        estimates={estimates}
        busy={busy}
        onSend={(text, planned) => {
          plan.current = planned;
          void sendMessage({ text });
        }}
        onStop={working || catchingUp ? stopTurn : undefined}
      />
    </>
  );
}

function costLine(estimate: ChatEstimate): string {
  if (estimate.step === null || estimate.turn === null) {
    return "no pinned price on this route";
  }
  return `a step ≈ ${money(estimate.step)} · a turn at most ${money(estimate.turn)}`;
}

function Composer({
  estimates,
  busy,
  onSend,
  onStop,
}: {
  estimates: ChatPanelData["estimates"];
  busy: boolean;
  onSend: (text: string, plan: boolean) => void;
  onStop?: () => void;
}) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState(false);
  const estimate = plan ? estimates.deep : estimates.fast;
  const send = () => {
    const message = text.trim();
    if (!message || busy) return;
    onSend(message, plan);
    setText("");
    setPlan(false);
  };
  return (
    <form
      className="flex flex-col gap-2 border-t border-border-soft px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label className="sr-only" htmlFor="chat-input">
        Message Kiln
      </label>
      <Textarea
        id="chat-input"
        data-testid="chat-input"
        value={text}
        rows={2}
        maxLength={8_000}
        placeholder="Ask Kiln, e.g. generate the waiting scenes"
        className="max-h-40 min-h-12 resize-none rounded-field border-border bg-secondary font-sans text-[0.8125rem] focus-visible:ring-1 focus-visible:ring-ring"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <Switch
          checked={plan}
          onChange={setPlan}
          disabled={busy}
          testId="chat-plan"
          label="Plan first, on the deep route"
        >
          Plan first
        </Switch>
        <span
          className="min-w-0 flex-1 truncate text-right font-mono text-[0.6rem] text-on-surface-dim"
          title={estimate.models.join(" → ")}
          data-testid="chat-estimate"
        >
          {costLine(estimate)}
        </span>
        {onStop ? (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Stop the turn"
            data-testid="chat-stop"
            onClick={onStop}
          >
            <Square className="size-3" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Send"
            data-testid="chat-send"
            disabled={busy || !text.trim()}
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );
}

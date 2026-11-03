"use client";

import {
  AlertCircle,
  Check,
  ChevronRight,
  CircleSlash,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Streamdown } from "streamdown";
import { decideLessonAction } from "@/app/actions/lessons";
import { money } from "@/components/chat/chat-spend";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import { draftApprovalLines } from "@/lib/drafts-view";
import type { KilnMessage } from "@/server/chat/messages";
import type { SpecialistId } from "@/server/chat/specialists";

// One message of the chat as the maker reads it: the maker's own on the
// right; the agent's text, each tool it ran (one quiet line, its details on
// a click), a call that waits for the maker's click (the approval card) and
// Kiln's notices on the left, with the models it ran on and what it cost.

type Part = KilnMessage["parts"][number];

export interface ToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorText?: string;
  approval?: { id: string; approved?: boolean; isAutomatic?: boolean };
}

export interface QuoteView {
  typicalUsd: number;
  atMostUsd: number;
  fitsCap?: boolean;
  lines?: { model?: string; fallbacks?: string[] }[];
}

// The tools that spend (the server's NEEDS_CLICK, less approve_frame,
// deliver and the draft writes): their card shows the quote's cost.
export const PAID = new Set([
  "generate",
  "draw",
  "write_listing",
  "review_product",
]);

export function toolName(part: { type: string }): string | null {
  return part.type.startsWith("tool-") ? part.type.slice(5) : null;
}

function asTool(part: Part): ToolPart | null {
  return toolName(part) ? (part as unknown as ToolPart) : null;
}

// The quote a paid call runs on, as the quote tool answered it earlier in
// the conversation.
export function quoteFor(
  messages: KilnMessage[],
  id: unknown,
): QuoteView | null {
  if (typeof id !== "string") return null;
  for (const message of messages) {
    for (const part of message.parts) {
      const tool = asTool(part);
      if (
        tool &&
        toolName(tool) === "quote" &&
        tool.state === "output-available" &&
        tool.output?.quote === id
      ) {
        return tool.output as unknown as QuoteView;
      }
    }
  }
  return null;
}

function models(quote: QuoteView): string {
  const names = new Set<string>();
  for (const line of quote.lines ?? []) if (line.model) names.add(line.model);
  return [...names].join(", ");
}

function ApprovalCard({
  name,
  title,
  tool,
  quote,
  onAnswer,
  disabled,
}: {
  name: string;
  title: string;
  tool: ToolPart;
  quote: QuoteView | null;
  onAnswer: (approved: boolean) => void;
  disabled: boolean;
}) {
  const take = typeof tool.input?.take === "string" ? tool.input.take : null;
  const paid = PAID.has(name);
  return (
    <div
      className="flex flex-col gap-3 rounded-render bg-card p-4 shadow-card"
      data-testid={`chat-approval-${name}`}
    >
      <div className="font-sans text-[0.6rem] font-bold tracking-[0.18em] text-prov-brand uppercase">
        Waits for your ok
      </div>
      <div className="font-sans text-sm font-semibold text-foreground">
        {title}
        {typeof tool.input?.frame === "string" ? (
          <span className="ml-1.5 font-mono text-[0.7rem] font-normal text-on-surface-mid">
            {tool.input.frame}
          </span>
        ) : null}
      </div>
      {draftApprovalLines(name, tool.input).length > 0 ? (
        <ul
          className="flex flex-col gap-0.5 font-sans text-[0.75rem] text-foreground [overflow-wrap:anywhere]"
          data-testid={`chat-approval-lines-${name}`}
        >
          {draftApprovalLines(name, tool.input).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {take ? (
        // biome-ignore lint/performance/noImgElement: a take from Kiln's own storage
        <img
          src={take}
          alt="The take to approve"
          className="h-[150px] w-full rounded-render object-cover shadow-render"
        />
      ) : null}
      {paid ? (
        quote ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[0.7rem] text-on-surface-mid">
            <dt>typical</dt>
            <dd className="text-foreground">{money(quote.typicalUsd)}</dd>
            <dt>at most</dt>
            <dd className="text-foreground">{money(quote.atMostUsd)}</dd>
            {models(quote) ? (
              <>
                <dt>on</dt>
                <dd>{models(quote)}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="font-sans text-[0.75rem] text-on-surface-mid">
            Its quote is not in this conversation; Kiln runs it only as quoted,
            or refuses it.
          </p>
        )
      ) : null}
      {quote?.fitsCap === false ? (
        <p className="font-sans text-[0.75rem] text-prov-local">
          It may not fit what is left of this month's cap.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={disabled}
          data-testid={`chat-approve-${name}`}
          onClick={() => onAnswer(true)}
        >
          <Check />
          {paid && quote
            ? `Approve · at most ${money(quote.atMostUsd)}`
            : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          data-testid={`chat-decline-${name}`}
          onClick={() => onAnswer(false)}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}

function ToolLine({
  name,
  title,
  tool,
}: {
  name: string;
  title: string;
  tool: ToolPart;
}) {
  const icon =
    tool.state === "output-available" ? (
      <Check className="size-3 text-prov-recipe" />
    ) : tool.state === "output-error" ? (
      <AlertCircle className="size-3 text-prov-local" />
    ) : tool.state === "output-denied" ? (
      <CircleSlash className="size-3 text-on-surface-dim" />
    ) : (
      <Loader2 className="size-3 animate-spin text-on-surface-dim" />
    );
  const status =
    tool.state === "output-denied"
      ? "not run: you said no"
      : tool.state === "approval-responded"
        ? tool.approval?.approved
          ? "approved, running"
          : "declined"
        : null;
  const shown =
    name === "view_frame" && typeof tool.output?.output === "string"
      ? tool.output.output
      : null;
  return (
    <Collapsible
      className="flex flex-col gap-1.5"
      data-testid={`chat-tool-${name}`}
    >
      <CollapsibleTrigger
        data-testid={`chat-tool-open-${name}`}
        className="group flex items-center gap-1.5 self-start rounded-pill bg-secondary px-2.5 py-1 font-sans text-[0.72rem] font-semibold text-on-surface-mid transition-colors hover:text-foreground"
      >
        {icon}
        {title}
        {status ? (
          <span className="font-normal text-on-surface-dim">· {status}</span>
        ) : null}
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      {tool.state === "output-error" && tool.errorText ? (
        <p className="pl-2.5 font-sans text-[0.75rem] text-prov-local">
          {tool.errorText}
        </p>
      ) : null}
      {shown && /\.(png|jpe?g|webp)(\?|$)/i.test(shown) ? (
        // biome-ignore lint/performance/noImgElement: a take from Kiln's own storage
        <img
          src={shown}
          alt={`The take of ${String(tool.input?.frame ?? "the frame")}`}
          className="h-[120px] w-[160px] rounded-render object-cover shadow-render"
        />
      ) : null}
      <CollapsibleContent>
        <pre className="max-h-60 overflow-auto rounded-field bg-secondary px-3 py-2 font-mono text-[0.65rem] leading-relaxed whitespace-pre-wrap text-on-surface-mid">
          {JSON.stringify(
            {
              input: tool.input,
              ...(tool.output ? { output: stripImages(tool.output) } : {}),
            },
            null,
            2,
          )}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function stripImages(output: Record<string, unknown>) {
  const { images: _images, ...rest } = output;
  return rest;
}

// Kiln's suggestion to switch to a specialist: a button that switches the
// chip (it runs nothing).
function Suggestion({
  tool,
  specialists,
  specialist,
  onSwitch,
}: {
  tool: ToolPart;
  specialists: { id: SpecialistId; label: string; about: string }[];
  specialist: SpecialistId;
  onSwitch: (id: SpecialistId) => void;
}) {
  const asked = specialists.find((s) => s.id === tool.input?.specialist);
  if (!asked) return null;
  const why =
    typeof tool.input?.why === "string" ? tool.input.why : asked.about;
  return (
    <div
      className="flex flex-wrap items-center gap-2 self-start rounded-field bg-secondary px-3 py-2"
      data-testid="chat-suggestion"
    >
      <span className="font-sans text-[0.78rem] text-foreground">
        {asked.label} does this best: {why}
      </span>
      {asked.id === specialist ? (
        <span className="font-mono text-[0.62rem] text-prov-recipe">
          switched
        </span>
      ) : (
        <Button
          size="xs"
          variant="outline"
          data-testid={`chat-switch-${asked.id}`}
          onClick={() => onSwitch(asked.id)}
        >
          Switch to {asked.label}
        </Button>
      )}
    </div>
  );
}

// A lesson an agent proposed, with the maker's Keep or Not this; it counts
// only once kept. Its status is the server's when the chat opened, then the
// maker's click.
function LessonProposal({ tool, known }: { tool: ToolPart; known?: string }) {
  const lesson = tool.output?.lesson as
    | { id?: string; text?: string; status?: string }
    | undefined;
  const [status, setStatus] = useState(known ?? lesson?.status ?? "proposed");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!lesson?.id || !lesson.text) return null;
  const id = lesson.id;
  const decide = (next: "kept" | "dismissed") =>
    startTransition(async () => {
      const result = await decideLessonAction({ id, status: next });
      if ("error" in result) setError(result.error);
      else setStatus(result.status);
    });
  return (
    <div
      className="flex flex-col gap-1.5 self-start rounded-field bg-secondary px-3 py-2"
      data-testid="chat-lesson"
    >
      <span className="font-mono text-[0.62rem] text-on-surface-dim">
        A lesson to keep?
      </span>
      <span className="font-sans text-[0.78rem] text-foreground">
        {lesson.text}
      </span>
      {status === "proposed" ? (
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            disabled={pending}
            data-testid="chat-lesson-keep"
            onClick={() => decide("kept")}
          >
            Keep
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            data-testid="chat-lesson-dismiss"
            onClick={() => decide("dismissed")}
          >
            Not this
          </Button>
        </div>
      ) : (
        <span className="font-mono text-[0.62rem] text-prov-recipe">
          {status === "kept" ? "kept: every agent follows it" : "set aside"}
        </span>
      )}
      {error ? (
        <span className="font-mono text-[0.62rem] text-prov-local">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ChatMessage({
  message,
  messages,
  toolTitles,
  busy,
  specialists,
  specialist,
  lessons,
  onSwitch,
  onAnswer,
}: {
  message: KilnMessage;
  messages: KilnMessage[];
  toolTitles: Record<string, string>;
  busy: boolean;
  specialists: { id: SpecialistId; label: string; about: string }[];
  specialist: SpecialistId;
  // Each proposed lesson's status when the chat opened, by id.
  lessons: Record<string, string>;
  onSwitch: (id: SpecialistId) => void;
  onAnswer: (approvalId: string, approved: boolean) => void;
}) {
  if (message.role === "user") {
    const text = message.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n");
    return (
      <Message align="end" data-testid="chat-message-user">
        <MessageContent>
          <div className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] bg-secondary px-3 py-2 font-sans text-[0.8125rem] whitespace-pre-wrap text-foreground">
            {text}
          </div>
        </MessageContent>
      </Message>
    );
  }
  const meta = message.metadata;
  return (
    <Message data-testid="chat-message-agent">
      <MessageContent className="gap-2">
        {message.parts.map((part, i) => {
          const key = `${message.id}-${i}`;
          if (part.type === "text") {
            return part.text.trim() ? (
              <Streamdown
                key={key}
                className="font-sans text-[0.8125rem] leading-relaxed text-foreground [&_a]:text-primary [&_strong]:font-semibold"
              >
                {part.text}
              </Streamdown>
            ) : null;
          }
          if (part.type === "data-kiln-event") {
            return (
              <div
                key={key}
                className="flex items-start gap-2 rounded-field bg-prov-recipe/10 px-3 py-2"
                data-testid="chat-event"
              >
                <Sparkles className="mt-0.5 size-3 shrink-0 text-prov-recipe" />
                <span className="font-sans text-[0.78rem] text-foreground">
                  {part.data.text}
                </span>
              </div>
            );
          }
          const tool = asTool(part);
          const name = tool ? toolName(tool) : null;
          if (!tool || !name) return null;
          if (name === "suggest_specialist") {
            return (
              <Suggestion
                key={key}
                tool={tool}
                specialists={specialists}
                specialist={specialist}
                onSwitch={onSwitch}
              />
            );
          }
          if (name === "propose_lesson" && tool.state === "output-available") {
            const id = (tool.output?.lesson as { id?: string } | undefined)?.id;
            return (
              <LessonProposal
                key={key}
                tool={tool}
                known={id ? lessons[id] : undefined}
              />
            );
          }
          const title = toolTitles[name] ?? name;
          if (
            tool.state === "approval-requested" &&
            tool.approval &&
            !tool.approval.isAutomatic
          ) {
            const approvalId = tool.approval.id;
            return (
              <ApprovalCard
                key={key}
                name={name}
                title={title}
                tool={tool}
                quote={quoteFor(messages, tool.input?.quote)}
                disabled={busy}
                onAnswer={(approved) => onAnswer(approvalId, approved)}
              />
            );
          }
          return <ToolLine key={key} name={name} title={title} tool={tool} />;
        })}
        {meta?.models?.length || meta?.stopped ? (
          <MessageFooter className="flex-wrap gap-1.5 px-0 font-mono text-[0.62rem] font-normal text-on-surface-dim">
            {meta.models?.length ? (
              <span>{meta.models.join(" → ")}</span>
            ) : null}
            {meta.costMicros ? (
              <span>· text {money(meta.costMicros / 1_000_000)}</span>
            ) : null}
            {meta.specialist && meta.specialist !== "kiln" ? (
              <span>
                ·{" "}
                {specialists.find((s) => s.id === meta.specialist)?.label ??
                  meta.specialist}
              </span>
            ) : null}
            {meta.role === "deep" ? <span>· planned</span> : null}
            {meta.stopped ? (
              <span className="text-prov-local">· {meta.stopped}</span>
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

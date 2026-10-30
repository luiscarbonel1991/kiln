import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { errorMessage } from "@/domain/queue";
import {
  appendChatEvent,
  getChat,
  lockChat,
  saveChatMessages,
  unlockChat,
} from "@/server/chat/chat-repository";
import { chatTools, TOOL_APPROVAL } from "@/server/chat/chat-tools";
import { chatInstructions } from "@/server/chat/instructions";
import {
  type ChatMetadata,
  forModel,
  isEvent,
  type KilnMessage,
  mergeIncoming,
  withoutImageData,
} from "@/server/chat/messages";
import "@/server/chat/no-gateway";
import { newLedger, routedChatModel } from "@/server/chat/routed-model";
import { SPECIALISTS, type SpecialistId } from "@/server/chat/specialists";

// One turn of the chat (ROADMAP "Agents", stage 2): one request, run inside
// Kiln (Luis, 2026-10-30: no Vercel). It takes the session's lock, adds what
// the maker did to the stored conversation, and streams the agent's reply
// while it runs Kiln's tools on its role's route, at most MAX_STEPS model
// calls and TURN_MS long. Each step is stored as it ends, so a closed tab or
// a reload loses nothing; Stop ends the turn from another request.

export const MAX_STEPS = 12;
export const TURN_MS = 4 * 60_000;

export class TurnRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// The turns running in this process, by session, so Stop can end one.
const globalForTurns = globalThis as {
  kilnChatTurns?: Map<string, AbortController>;
};
globalForTurns.kilnChatTurns ??= new Map();
const running = globalForTurns.kilnChatTurns;

export function stopTurn(sessionId: string): boolean {
  const turn = running.get(sessionId);
  turn?.abort(new Error("Stopped by the maker."));
  return turn !== undefined;
}

function wordsFor(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    const reason = signal.reason as
      | { name?: string; message?: string }
      | undefined;
    return reason?.name === "TimeoutError"
      ? `The turn ran out of time (${TURN_MS / 60_000} minutes).`
      : (reason?.message ?? "Stopped.");
  }
  return errorMessage(error);
}

const stored = (messages: KilnMessage[]) =>
  messages.filter((m) => !isEvent(m)).map(withoutImageData);

export async function runTurn(input: {
  sessionId: string;
  message: unknown;
  plan?: boolean;
  specialist?: SpecialistId;
}): Promise<Response> {
  const { sessionId } = input;
  const chat = await getChat(sessionId);
  if (!chat)
    throw new TurnRefusal("No conversation of yours has that id.", 404);
  const lock = await lockChat(sessionId);
  if (!lock.locked) {
    throw new TurnRefusal(
      "A turn is running in this conversation: wait for it, or stop it.",
      409,
    );
  }
  try {
    const merged = mergeIncoming(chat.messages, input.message);
    if ("error" in merged) throw new TurnRefusal(merged.error, 400);
    if (lock.stale) {
      await appendChatEvent(
        { sessionId },
        `interrupted-${Date.now()}`,
        "The last turn stopped before it ended; what it did is above.",
      );
    }
    const messages = merged.messages;
    await saveChatMessages(sessionId, stored(messages));

    const role = input.plan ? "deep" : "fast";
    const ledger = newLedger();
    const ctx = { tokenId: null, tokenName: "Chat", canSpend: true, sessionId };
    const specialist = SPECIALISTS[input.specialist ?? "kiln"];
    const tools = chatTools(ctx, specialist);
    const model = await routedChatModel(input.plan ? "chatPlan" : "chatTurn", {
      ...(chat.projectId ? { projectId: chat.projectId } : {}),
      ledger,
    });
    const visible = messages.filter((m) => !isEvent(m));
    const last = visible.at(-1);
    const priorMicros =
      last?.role === "assistant" ? (last.metadata?.costMicros ?? 0) : 0;
    const metadata = (): ChatMetadata => ({
      role,
      specialist: specialist.id,
      models: ledger.models,
      ...(ledger.moves.length ? { moves: ledger.moves } : {}),
      costMicros: priorMicros + ledger.costMicros,
    });

    const stop = new AbortController();
    running.set(sessionId, stop);
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(TURN_MS)]);
    let ended = false;
    const end = async () => {
      if (ended) return;
      ended = true;
      running.delete(sessionId);
      await unlockChat(sessionId);
    };

    const result = streamText({
      model,
      instructions: await chatInstructions(chat.projectId, specialist),
      tools,
      toolApproval: TOOL_APPROVAL,
      messages: await convertToModelMessages(forModel(messages), {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
      stopWhen: isStepCount(MAX_STEPS),
      maxRetries: 0,
      abortSignal: signal,
    });
    // The turn runs to its end even when the browser goes away.
    void result.consumeStream();

    const stream = toUIMessageStream<typeof tools, KilnMessage>({
      stream: result.stream,
      tools,
      originalMessages: visible,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      messageMetadata: ({ part }) =>
        part.type === "start" ||
        part.type === "finish-step" ||
        part.type === "finish"
          ? metadata()
          : undefined,
      onStepEnd: async ({ messages: now }) => {
        await saveChatMessages(sessionId, stored(now)).catch((error) =>
          console.error("[kiln chat] could not store a step", error),
        );
      },
      onEnd: async ({ messages: now, isAborted }) => {
        try {
          const final = now.map((m, i) =>
            i === now.length - 1 && m.role === "assistant"
              ? {
                  ...m,
                  metadata: {
                    ...metadata(),
                    ...(isAborted ? { stopped: wordsFor(null, signal) } : {}),
                  },
                }
              : m,
          );
          await saveChatMessages(sessionId, stored(final));
        } catch (error) {
          console.error("[kiln chat] could not store a turn", error);
        } finally {
          await end();
        }
      },
      onError: (error) => wordsFor(error, signal),
    });
    return createUIMessageStreamResponse({
      stream,
      // A copy read here keeps the turn's stream, and its storing, going
      // when the browser stops reading.
      consumeSseStream: ({ stream: copy }) => {
        void copy.pipeTo(new WritableStream()).catch(() => {});
      },
    });
  } catch (error) {
    running.delete(sessionId);
    await unlockChat(sessionId);
    throw error;
  }
}

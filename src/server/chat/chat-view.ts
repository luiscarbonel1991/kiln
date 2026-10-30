import { getChat, listChatSessions } from "@/server/chat/chat-repository";
import type { KilnMessage } from "@/server/chat/messages";
import { MAX_STEPS } from "@/server/chat/run-turn";
import { SPECIALIST_CHOICES } from "@/server/chat/specialists";
import { textRoute } from "@/server/text-calls";
import { TOOLS } from "@/server/tools";

// What the chat panel needs to open: the conversation (a project's latest,
// or the one asked for), whether a turn runs in it, the tools' titles, and
// what a turn costs before the maker sends one: a step on its role's route
// and the most a turn can cost (MAX_STEPS steps on the dearest model).

export interface ChatEstimate {
  step: number | null;
  turn: number | null;
  models: string[];
}

export interface ChatPanelData {
  sessionId: string | null;
  messages: KilnMessage[];
  running: boolean;
  estimates: { fast: ChatEstimate; deep: ChatEstimate };
  toolTitles: Record<string, string>;
  specialists: typeof SPECIALIST_CHOICES;
}

async function estimate(kind: "chatTurn" | "chatPlan"): Promise<ChatEstimate> {
  const route = await textRoute(kind);
  return {
    step: route.typical,
    turn: route.max === null ? null : route.max * MAX_STEPS,
    models: route.labels,
  };
}

export async function chatPanelData(target: {
  projectId?: string;
  sessionId?: string;
}): Promise<ChatPanelData> {
  const sessionId =
    target.sessionId ??
    (target.projectId
      ? ((await listChatSessions({ projectId: target.projectId }, 1))[0]?.id ??
        null)
      : null);
  const chat = sessionId ? await getChat(sessionId) : null;
  return {
    sessionId: chat?.id ?? null,
    messages: chat?.messages ?? [],
    running: chat?.running ?? false,
    estimates: {
      fast: await estimate("chatTurn"),
      deep: await estimate("chatPlan"),
    },
    toolTitles: Object.fromEntries(TOOLS.map((t) => [t.name, t.title])),
    specialists: SPECIALIST_CHOICES,
  };
}

import type { Effort } from "@/domain/effort";
import { providerMode } from "@/providers/mode";
import { agentRouteIn } from "@/server/chat/agent-route";
import {
  chatOwned,
  getChat,
  listChatSessions,
} from "@/server/chat/chat-repository";
import type { KilnMessage } from "@/server/chat/messages";
import { MAX_STEPS } from "@/server/chat/run-turn";
import { SPECIALIST_CHOICES, SpecialistId } from "@/server/chat/specialists";
import { isDesign } from "@/server/designs";
import {
  type SessionSpend,
  sessionSpend,
} from "@/server/generation-repository";
import { lessonStatuses } from "@/server/lessons";
import { getCurrentMaker, getMakerModelSetup } from "@/server/maker-repository";
import { routeView } from "@/server/text-calls";
import { TOOLS } from "@/server/tools";

// What the chat panel needs to open: the conversation (a project's latest,
// or the one asked for), whether a turn runs in it, the tools' titles, and
// what a turn costs before the maker sends one, for each agent: a step on
// its route at its effort and the most a turn can cost (MAX_STEPS steps on
// the dearest model), and what the conversation's paid tools spent so far.

export interface ChatEstimate {
  step: number | null;
  turn: number | null;
  models: string[];
  effort: Effort;
}

// An agent's turn and its turn planned first; `own` when it runs on a route
// of its own.
export interface AgentEstimate {
  turn: ChatEstimate;
  plan: ChatEstimate;
  own: boolean;
}

export interface ChatPanelData {
  sessionId: string | null;
  messages: KilnMessage[];
  running: boolean;
  estimates: Record<SpecialistId, AgentEstimate>;
  toolTitles: Record<string, string>;
  specialists: typeof SPECIALIST_CHOICES;
  // The mode a new conversation starts in: SVG on a design.
  firstSpecialist: SpecialistId;
  design: boolean;
  // The status of each lesson an agent proposed in it, by id.
  lessons: Record<string, string>;
  // What its paid tools spent and hold (its text is on its replies); null in
  // a mock run, where nothing is paid.
  runs: SessionSpend | null;
}

const NOTHING: SessionSpend = { spentMicros: 0, queuedMicros: 0 };

async function runsOf(sessionId: string | null): Promise<SessionSpend | null> {
  if (providerMode() === "mock") return null;
  if (!sessionId) return NOTHING;
  return sessionSpend((await getCurrentMaker()).id, sessionId);
}

// What a conversation's paid tools spent and hold, as the chat reads it
// while they run: null when it is not the maker's.
export async function chatRuns(
  sessionId: string,
): Promise<{ runs: SessionSpend | null } | null> {
  if (!(await chatOwned(sessionId))) return null;
  return { runs: await runsOf(sessionId) };
}

async function estimates(): Promise<Record<SpecialistId, AgentEstimate>> {
  const setup = await getMakerModelSetup();
  const estimate = (
    id: SpecialistId,
    kind: "chatTurn" | "chatPlan",
  ): ChatEstimate & { own: boolean } => {
    const route = agentRouteIn(setup, id, kind);
    const view = routeView(kind, route.candidates, route.effort);
    return {
      step: view.typical,
      turn: view.max === null ? null : view.max * MAX_STEPS,
      models: view.labels,
      effort: view.effort,
      own: route.own,
    };
  };
  return Object.fromEntries(
    SpecialistId.options.map((id) => {
      const { own, ...turn } = estimate(id, "chatTurn");
      const { own: _, ...plan } = estimate(id, "chatPlan");
      return [id, { turn, plan, own }];
    }),
  ) as Record<SpecialistId, AgentEstimate>;
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
  const design = target.projectId ? await isDesign(target.projectId) : false;
  const proposed = (chat?.messages ?? []).flatMap((m) =>
    m.parts.flatMap((p) => {
      const id =
        p.type === "tool-propose_lesson"
          ? (p as { output?: { lesson?: { id?: unknown } } }).output?.lesson?.id
          : undefined;
      return typeof id === "string" ? [id] : [];
    }),
  );
  return {
    sessionId: chat?.id ?? null,
    messages: chat?.messages ?? [],
    running: chat?.running ?? false,
    estimates: await estimates(),
    toolTitles: Object.fromEntries(TOOLS.map((t) => [t.name, t.title])),
    specialists: SPECIALIST_CHOICES,
    firstSpecialist: design ? "svg" : "kiln",
    design,
    lessons: await lessonStatuses(proposed),
    runs: await runsOf(chat?.id ?? null),
  };
}

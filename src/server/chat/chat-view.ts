import type { Effort } from "@/domain/effort";
import { agentRouteIn } from "@/server/chat/agent-route";
import { getChat, listChatSessions } from "@/server/chat/chat-repository";
import type { KilnMessage } from "@/server/chat/messages";
import { MAX_STEPS } from "@/server/chat/run-turn";
import { SPECIALIST_CHOICES, SpecialistId } from "@/server/chat/specialists";
import { isDesign } from "@/server/designs";
import { lessonStatuses } from "@/server/lessons";
import { getMakerModelSetup } from "@/server/maker-repository";
import { routeView } from "@/server/text-calls";
import { TOOLS } from "@/server/tools";

// What the chat panel needs to open: the conversation (a project's latest,
// or the one asked for), whether a turn runs in it, the tools' titles, and
// what a turn costs before the maker sends one, for each agent: a step on
// its route at its effort and the most a turn can cost (MAX_STEPS steps on
// the dearest model).

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
  };
}

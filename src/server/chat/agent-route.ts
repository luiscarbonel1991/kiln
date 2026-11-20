import type { Effort } from "@/domain/effort";
import { type MakerModels, modelLabel } from "@/domain/model-defaults";
import {
  type AgentRoutes,
  type MakerRoutes,
  type RouteEntry,
  routeCandidates,
  routeEffort,
  routeSees,
} from "@/domain/model-routing";
import { LEFT_OUT } from "@/server/chat/chat-tools";
import type { ChatKind } from "@/server/chat/routed-model";
import {
  SPECIALISTS,
  type Specialist,
  SpecialistId,
} from "@/server/chat/specialists";
import type { MakerRef } from "@/server/maker-repository";
import { getMakerModelSetup } from "@/server/maker-repository";
import { roleCandidates } from "@/server/text-calls";
import { TOOLS } from "@/server/tools";

// The route an agent's turn runs on (Luis, 2026-10-31: every agent may run on
// any text model, at its own effort): its own when the maker gave it one,
// turns and plans alike, so planning never moves it to another model; else
// the fast route, or deep when the maker plans first.

export interface AgentRoute {
  candidates: RouteEntry[];
  effort: Effort;
  own: boolean;
}

export function agentRouteIn(
  setup: {
    models: MakerModels;
    routes: MakerRoutes | null;
    agents: AgentRoutes;
  },
  id: SpecialistId,
  kind: ChatKind,
): AgentRoute {
  const own = setup.agents[id];
  if (own) {
    return {
      candidates: routeCandidates(own, own.models[0]),
      effort: routeEffort(own),
      own: true,
    };
  }
  return { ...roleCandidates(setup, kind), own: false };
}

export async function agentRoute(
  maker: MakerRef,
  id: SpecialistId,
  kind: ChatKind,
): Promise<AgentRoute> {
  return agentRouteIn(await getMakerModelSetup(maker), id, kind);
}

// Whether an agent looks at images (one of its tools shows them), so every
// model of its route must read them.
export function agentLooks(specialist: Pick<Specialist, "tools">): boolean {
  return TOOLS.some(
    (t) =>
      t.hints.showsImages &&
      !LEFT_OUT.has(t.name) &&
      (specialist.tools === null || specialist.tools.includes(t.name)),
  );
}

// Why the agents' routes cannot be saved: an agent Kiln does not have, or a
// model that reads no images for an agent that looks at them. Null when they
// can.
export function agentRoutesProblem(agents: AgentRoutes): string | null {
  for (const [id, route] of Object.entries(agents)) {
    const known = SpecialistId.safeParse(id);
    if (!known.success) return `Kiln has no agent "${id}".`;
    const specialist = SPECIALISTS[known.data];
    if (!agentLooks(specialist) || routeSees(route)) continue;
    const blind = route.models.find(
      (m) => !routeSees({ models: [m], fallback: false }),
    );
    return `${specialist.label} looks at images: ${blind ? modelLabel(blind) : "a model of its route"} does not read them.`;
  }
  return null;
}

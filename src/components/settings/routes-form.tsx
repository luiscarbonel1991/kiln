"use client";

import { ArrowDown, ArrowUp, Check, Loader2, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { saveMakerRoutesAction } from "@/app/actions/settings";
import {
  ModelChoice,
  type ProviderNote,
} from "@/components/models/model-choice";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_EFFORT,
  EFFORT_LABELS,
  Effort,
  effortOn,
  topEffort,
} from "@/domain/effort";
import {
  modelPriced,
  textBudget,
  textEstimate,
} from "@/domain/generation-cost";
import {
  catalogFor,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_VIDEO_RESOLUTION,
  type ModelKind,
  modelLabel,
  PROVIDER_LABELS,
} from "@/domain/model-defaults";
import {
  type AgentRoutes,
  MAX_ROUTE,
  type MakerRoutes,
  type ModelRole,
  ROLE_KIND,
  type Route,
  type RouteEntry,
  sameModel,
} from "@/domain/model-routing";
import { routeKeyLine } from "@/lib/provider-key-words";
import { cn } from "@/lib/utils";

const ROLES: { role: ModelRole; label: string; what: string; off: string }[] = [
  {
    role: "deep",
    label: "Text · deep",
    what: "Reads a product photo, drafts a product, directs the studio's scenes, writes the listing text and plans a chat turn.",
    off: "Off: a call that fails says why and offers the other provider.",
  },
  {
    role: "fast",
    label: "Text · fast",
    what: "Reviews the product form and runs the chat's agents that have no model of their own.",
    off: "Off: a call that fails says why and offers the other provider.",
  },
  {
    role: "final",
    label: "Images · final",
    what: "What the board's frames start on: everything you deliver.",
    off: "Off: a frame that fails says why and nothing else runs. On, a batch moves together, since another model changes the look.",
  },
  {
    role: "draft",
    label: "Images · draft",
    what: "What the studio's new cards start on, to explore.",
    off: "Off: a take that fails says why and nothing else runs.",
  },
  {
    role: "video",
    label: "Video",
    what: "What a listing video starts on; it animates an approved scene.",
    off: "Off: a video that fails says why and nothing else runs.",
  },
];

const AGENT_OFF = "Off: a turn that fails says why; nothing else runs.";

const money = (usd: number) => `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;

export interface AgentChoice {
  id: string;
  label: string;
  about: string;
}

// Settings → Models: a route per role and, for each chat agent, a route of its
// own when the maker gives it one (Luis, 2026-10-31). The first model is what
// the work starts on; with fallback on, a failure another model can fix moves
// down the route, and nothing outside it ever runs. A text route has an effort:
// how hard its models think. Until the maker saves, the routes shown are Kiln's
// proposal and every task runs its one model with no fallback.
export function RoutesForm({
  initial,
  initialAgents,
  agentChoices,
  saved,
  notes,
  mock,
  ask,
}: {
  initial: MakerRoutes;
  initialAgents: AgentRoutes;
  agentChoices: AgentChoice[];
  saved: boolean;
  notes: ProviderNote[];
  mock: boolean;
  // Whom a member asks about a key; null for the owner.
  ask: string | null;
}) {
  const [routes, setRoutes] = useState<MakerRoutes>(initial);
  const [agents, setAgents] = useState<AgentRoutes>(initialAgents);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const dirty =
    !saved ||
    JSON.stringify(routes) !== JSON.stringify(initial) ||
    JSON.stringify(agents) !== JSON.stringify(initialAgents);
  const keyed = (provider: RouteEntry["provider"]) =>
    mock || notes.find((n) => n.provider === provider)?.keyPresent !== false;
  const change = (role: ModelRole, next: Partial<Route>) => {
    setMessage(null);
    setRoutes((r) => ({ ...r, [role]: { ...r[role], ...next } }));
  };
  const changeAgent = (id: string, next: Route | null) => {
    setMessage(null);
    setAgents((a) => {
      const { [id]: _, ...rest } = a;
      return next ? { ...rest, [id]: next } : rest;
    });
  };
  const save = () =>
    startTransition(async () => {
      const result = await saveMakerRoutesAction({ routes, agents });
      setMessage(
        result.error ? { ok: false, error: result.error } : { ok: true },
      );
    });
  const editor = { notes, keyed, pending, ask };
  return (
    <div className="flex flex-col gap-4">
      {saved ? null : (
        <p
          data-testid="routes-proposed"
          className="rounded-render border border-border-soft bg-surface-soft px-4 py-3 font-sans text-[0.8rem] leading-snug text-on-surface-mid"
        >
          <span className="font-semibold text-prov-brand">Proposed</span> from
          your keys, starting on your current defaults. Until you save, every
          task runs its one model with no fallback.
        </p>
      )}
      {ROLES.map(({ role, label, what, off }) => {
        const kind = ROLE_KIND[role];
        return (
          <RouteRow
            key={role}
            label={label}
            what={what}
            testId={`route-${role}`}
          >
            <RouteEditor
              {...editor}
              kind={kind}
              route={routes[role]}
              label={label}
              off={off}
              testId={`route-${role}`}
              onChange={(next) => change(role, next)}
            />
            {kind === "text" ? (
              <EffortControl
                route={routes[role]}
                call={role === "deep" ? "chatPlan" : "chatTurn"}
                step={role === "deep" ? "a planned chat step" : "a chat step"}
                disabled={pending}
                testId={`route-${role}-effort`}
                onChange={(effort) => change(role, { effort })}
              />
            ) : null}
          </RouteRow>
        );
      })}
      <div className="pt-2">
        <h3 className="font-sans text-sm font-semibold text-foreground">
          Agents
        </h3>
        <p className="mt-0.5 max-w-[560px] font-sans text-[0.75rem] leading-snug text-on-surface-mid">
          Each of the chat&apos;s agents runs on Text · fast (deep when you plan
          first), or on a model of its own at its own effort, for turns and
          plans alike.
        </p>
      </div>
      {agentChoices.map((agent) => {
        const own = agents[agent.id];
        const testId = `agent-${agent.id}`;
        return (
          <RouteRow
            key={agent.id}
            label={agent.label}
            what={agent.about}
            testId={testId}
          >
            <Switch
              checked={own !== undefined}
              testId={`${testId}-own`}
              disabled={pending}
              onChange={(on) =>
                changeAgent(
                  agent.id,
                  on
                    ? {
                        models: routes.fast.models,
                        fallback: routes.fast.fallback,
                        effort: routes.fast.effort ?? DEFAULT_EFFORT,
                      }
                    : null,
                )
              }
            >
              Its own model
            </Switch>
            {own ? (
              <>
                <RouteEditor
                  {...editor}
                  kind="text"
                  route={own}
                  label={agent.label}
                  off={AGENT_OFF}
                  testId={testId}
                  onChange={(next) =>
                    changeAgent(agent.id, { ...own, ...next })
                  }
                />
                <EffortControl
                  route={own}
                  call="chatTurn"
                  step="a step"
                  disabled={pending}
                  testId={`${testId}-effort`}
                  onChange={(effort) =>
                    changeAgent(agent.id, { ...own, effort })
                  }
                />
              </>
            ) : (
              <p className="pl-10 font-sans text-[0.7rem] leading-snug text-on-surface-dim">
                Follows Text · fast: {modelLabel(routes.fast.models[0])},{" "}
                {EFFORT_LABELS[
                  routes.fast.effort ?? DEFAULT_EFFORT
                ].toLowerCase()}{" "}
                effort.
              </p>
            )}
          </RouteRow>
        );
      })}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          data-testid="routes-save"
          disabled={pending || !dirty}
          onClick={save}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          Save routes
        </Button>
        {message?.ok ? (
          <span className="font-mono text-[0.65rem] text-prov-recipe">
            Saved. New work follows these routes.
          </span>
        ) : message ? (
          <span className="font-mono text-[0.65rem] text-fail">
            {message.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RouteRow({
  label,
  what,
  testId,
  children,
}: {
  label: string;
  what: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="grid grid-cols-1 gap-2 border-b border-border-soft pb-4 sm:grid-cols-[150px_1fr] sm:gap-5"
    >
      <div>
        <div className="font-sans text-sm font-semibold text-foreground">
          {label}
        </div>
        <div className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
          {what}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

// One route's models in order, each with its picker, moves and removal; a
// fallback to add and the switch that lets a failure move down the route.
function RouteEditor({
  kind,
  route,
  label,
  off,
  testId,
  notes,
  keyed,
  pending,
  ask,
  onChange,
}: {
  kind: ModelKind;
  route: Route;
  label: string;
  off: string;
  testId: string;
  notes: ProviderNote[];
  keyed: (provider: RouteEntry["provider"]) => boolean;
  pending: boolean;
  ask: string | null;
  onChange: (next: Partial<Route>) => void;
}) {
  const spare = catalogFor(kind).find(
    (m) =>
      keyed(m.provider) &&
      modelPriced({ provider: m.provider, model: m.id }, kind) &&
      !route.models.some((r) =>
        sameModel(r, { provider: m.provider, model: m.id }),
      ),
  );
  const setModels = (models: RouteEntry[]) => onChange({ models });
  const move = (from: number, to: number) => {
    const models = [...route.models];
    const [entry] = models.splice(from, 1);
    models.splice(to, 0, entry);
    setModels(models);
  };
  return (
    <>
      <ol className="flex flex-col gap-1.5">
        {route.models.map((entry, i) => {
          const n = i + 1;
          const id = `${testId}-${n}`;
          return (
            <li
              key={`${entry.provider}/${entry.model}`}
              className="flex min-w-0 flex-col gap-0.5"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="w-9 flex-shrink-0 font-mono text-[0.6rem] text-on-surface-dim">
                  {i === 0 ? "first" : `then ${n}`}
                </span>
                <ModelChoice
                  kind={kind}
                  value={entry}
                  notes={notes}
                  disabled={pending}
                  testId={id}
                  label={`${label} model ${n}`}
                  className="flex-1"
                  onChange={(next) =>
                    setModels(route.models.map((m, j) => (j === i ? next : m)))
                  }
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  data-testid={`${id}-up`}
                  aria-label={`Move ${label} model ${n} up`}
                  disabled={pending || i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  data-testid={`${id}-down`}
                  aria-label={`Move ${label} model ${n} down`}
                  disabled={pending || i === route.models.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  data-testid={`${id}-remove`}
                  aria-label={`Remove ${label} model ${n}`}
                  disabled={pending || route.models.length === 1}
                  onClick={() =>
                    setModels(route.models.filter((_, j) => j !== i))
                  }
                >
                  <X />
                </Button>
              </div>
              {/* A member cannot fix it, so their row is not an alarm. */}
              {keyed(entry.provider) ? null : (
                <span
                  className={cn(
                    "pl-10 font-mono text-[0.6rem]",
                    ask === null ? "text-fail" : "text-on-surface-mid",
                  )}
                >
                  {routeKeyLine(PROVIDER_LABELS[entry.provider], ask, {
                    reach: notes.find((n) => n.provider === entry.provider)
                      ?.reach,
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3 pl-10">
        {spare && route.models.length < MAX_ROUTE ? (
          <Button
            size="xs"
            variant="outline"
            data-testid={`${testId}-add`}
            disabled={pending}
            onClick={() =>
              setModels([
                ...route.models,
                {
                  provider: spare.provider,
                  model: spare.id,
                  ...(spare.qualities
                    ? { quality: DEFAULT_IMAGE_QUALITY }
                    : {}),
                  ...(spare.seconds
                    ? { resolution: DEFAULT_VIDEO_RESOLUTION }
                    : {}),
                },
              ])
            }
          >
            <Plus />
            Add a fallback
          </Button>
        ) : null}
        <Switch
          checked={route.fallback}
          testId={`${testId}-fallback`}
          disabled={pending}
          onChange={(fallback) => onChange({ fallback })}
        >
          Fall back to the next model
        </Switch>
      </div>
      {route.fallback ? null : (
        <p className="pl-10 font-sans text-[0.7rem] leading-snug text-on-surface-dim">
          {off}
        </p>
      )}
    </>
  );
}

// How hard a text route's models think (domain/effort.ts): more effort, more
// thinking, more output and time, so what a chat step may cost grows with it.
// A model that thinks at most at a lower level says so.
function EffortControl({
  route,
  call,
  step,
  disabled,
  testId,
  onChange,
}: {
  route: Route;
  call: "chatTurn" | "chatPlan";
  step: string;
  disabled: boolean;
  testId: string;
  onChange: (effort: Effort) => void;
}) {
  const effort = route.effort ?? DEFAULT_EFFORT;
  const [first] = route.models;
  const usd = textEstimate(first, textBudget(call, first, effort));
  const capped = route.models.filter((m) => effortOn(m, effort) !== effort);
  return (
    <div className="flex flex-col gap-1 pl-10">
      <fieldset className="m-0 flex flex-wrap items-center gap-1 border-0 p-0">
        <legend className="mr-1 float-left font-mono text-[0.6rem] text-on-surface-dim">
          effort
        </legend>
        {Effort.options.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={level === effort}
            disabled={disabled}
            data-testid={`${testId}-${level}`}
            onClick={() => onChange(level)}
            className={cn(
              "rounded-pill px-2.5 py-0.5 font-sans text-[0.72rem] font-semibold transition-colors disabled:opacity-50",
              level === effort
                ? "bg-primary/10 text-primary"
                : "text-on-surface-mid hover:text-foreground",
            )}
          >
            {EFFORT_LABELS[level]}
          </button>
        ))}
      </fieldset>
      <span
        className="font-mono text-[0.6rem] text-on-surface-dim"
        data-testid={`${testId}-cost`}
      >
        {usd === null
          ? "no pinned price"
          : `${step} at most ${money(usd)} on ${modelLabel(first)}`}
      </span>
      {capped.map((m) => {
        const top = topEffort(m);
        return top ? (
          <span
            key={`${m.provider}/${m.model}`}
            className="font-mono text-[0.6rem] text-fail"
          >
            {modelLabel(m)} thinks at most at {EFFORT_LABELS[top].toLowerCase()}
            .
          </span>
        ) : null;
      })}
    </div>
  );
}

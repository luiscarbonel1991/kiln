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
import { modelPriced } from "@/domain/generation-cost";
import {
  catalogFor,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_VIDEO_RESOLUTION,
  PROVIDER_LABELS,
} from "@/domain/model-defaults";
import {
  MAX_ROUTE,
  type MakerRoutes,
  type ModelRole,
  ROLE_KIND,
  type RouteEntry,
  sameModel,
} from "@/domain/model-routing";

const ROLES: { role: ModelRole; label: string; what: string; off: string }[] = [
  {
    role: "deep",
    label: "Text · deep",
    what: "Reads a product photo, drafts a product, directs the studio's scenes and writes the listing text.",
    off: "Off: a call that fails says why and offers the other provider.",
  },
  {
    role: "fast",
    label: "Text · fast",
    what: "Reviews the product form and suggests its fields.",
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

const KEY_NAME = { openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };

// Settings → Models: a route per role (ROADMAP "Model routing"). The first
// model is what the role's work starts on; with fallback on, a failure another
// model can fix moves down the route, and nothing outside it ever runs.
// Until the maker saves, the routes shown are Kiln's proposal and every task
// runs its one model with no fallback.
export function RoutesForm({
  initial,
  saved,
  notes,
  mock,
}: {
  initial: MakerRoutes;
  saved: boolean;
  notes: ProviderNote[];
  mock: boolean;
}) {
  const [routes, setRoutes] = useState<MakerRoutes>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const dirty = !saved || JSON.stringify(routes) !== JSON.stringify(initial);
  const keyed = (provider: RouteEntry["provider"]) =>
    mock || notes.find((n) => n.provider === provider)?.keyPresent !== false;
  const change = (role: ModelRole, next: Partial<MakerRoutes[ModelRole]>) => {
    setMessage(null);
    setRoutes((r) => ({ ...r, [role]: { ...r[role], ...next } }));
  };
  const save = () =>
    startTransition(async () => {
      const result = await saveMakerRoutesAction(routes);
      setMessage(
        result.error ? { ok: false, error: result.error } : { ok: true },
      );
    });
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
        const route = routes[role];
        const spare = catalogFor(kind).find(
          (m) =>
            keyed(m.provider) &&
            modelPriced({ provider: m.provider, model: m.id }, kind) &&
            !route.models.some((r) =>
              sameModel(r, { provider: m.provider, model: m.id }),
            ),
        );
        const setModels = (models: RouteEntry[]) => change(role, { models });
        const move = (from: number, to: number) => {
          const models = [...route.models];
          const [entry] = models.splice(from, 1);
          models.splice(to, 0, entry);
          setModels(models);
        };
        return (
          <div
            key={role}
            data-testid={`route-${role}`}
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
            <div className="flex min-w-0 flex-col gap-2">
              <ol className="flex flex-col gap-1.5">
                {route.models.map((entry, i) => {
                  const n = i + 1;
                  const testId = `route-${role}-${n}`;
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
                          testId={testId}
                          label={`${label} model ${n}`}
                          className="flex-1"
                          onChange={(next) =>
                            setModels(
                              route.models.map((m, j) => (j === i ? next : m)),
                            )
                          }
                        />
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          data-testid={`${testId}-up`}
                          aria-label={`Move ${label} model ${n} up`}
                          disabled={pending || i === 0}
                          onClick={() => move(i, i - 1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          data-testid={`${testId}-down`}
                          aria-label={`Move ${label} model ${n} down`}
                          disabled={pending || i === route.models.length - 1}
                          onClick={() => move(i, i + 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          data-testid={`${testId}-remove`}
                          aria-label={`Remove ${label} model ${n}`}
                          disabled={pending || route.models.length === 1}
                          onClick={() =>
                            setModels(route.models.filter((_, j) => j !== i))
                          }
                        >
                          <X />
                        </Button>
                      </div>
                      {keyed(entry.provider) ? null : (
                        <span className="pl-10 font-mono text-[0.6rem] text-prov-local">
                          {PROVIDER_LABELS[entry.provider]} has no API key (
                          {KEY_NAME[entry.provider]}): this model cannot run.
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
                    data-testid={`route-${role}-add`}
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
                  testId={`route-${role}-fallback`}
                  disabled={pending}
                  onChange={(fallback) => change(role, { fallback })}
                >
                  Fall back to the next model
                </Switch>
              </div>
              {route.fallback ? null : (
                <p className="pl-10 font-sans text-[0.7rem] leading-snug text-on-surface-dim">
                  {off}
                </p>
              )}
            </div>
          </div>
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
          <span className="font-mono text-[0.65rem] text-prov-local">
            {message.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

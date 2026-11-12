import { CircleAlert, CircleCheck, KeyRound } from "lucide-react";
import { connection } from "next/server";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { AccessTokens } from "@/components/settings/access-tokens";
import { KeyCheck } from "@/components/settings/key-check";
import { Lessons } from "@/components/settings/lessons";
import { ProviderKey } from "@/components/settings/provider-key";
import { RoutesForm } from "@/components/settings/routes-form";
import { SceneLookSwitch } from "@/components/settings/scene-look-switch";
import { ToolCalls } from "@/components/settings/tool-calls";
import { EtsyConnection } from "@/components/shops/etsy-connection";
import { fromMicros } from "@/domain/generation-cost";
import { modelLabel } from "@/domain/model-defaults";
import { proposeRoutes } from "@/domain/model-routing";
import { hasDatabase } from "@/lib/db";
import { providerMode } from "@/providers/mode";
import { listAccessTokens } from "@/server/access-tokens";
import { SPECIALIST_CHOICES } from "@/server/chat/specialists";
import { budget } from "@/server/generation-repository";
import { listLessons } from "@/server/lessons";
import { getCurrentMaker, getMakerModelSetup } from "@/server/maker-repository";
import { providerHealth } from "@/server/provider-health";
import {
  type ProviderKeyState,
  providerKeyStates,
} from "@/server/provider-keys";
import { sceneLookSetup } from "@/server/scene-look";
import { etsySetup, shopConnection } from "@/server/shop-connection";
import { recentToolCalls } from "@/server/tool-calls";

const money = (usd: number) => `$${usd.toFixed(2)}`;
const lookMoney = (usd: number) => `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const ENV_NAME = { openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };

function keyLine(state: ProviderKeyState | undefined): string {
  if (!state) return "No API key yet";
  if (state.unreadable) {
    return `A saved key (ends in ${state.hint}) cannot be read: KILN_SECRET_KEY is missing or changed. Paste the key again.`;
  }
  if (state.source === "saved") return `API key saved, ends in ${state.hint}`;
  if (state.source === "env") {
    return `API key from the environment (${ENV_NAME[state.provider]})`;
  }
  return "No API key yet";
}

// Settings (per request: it reads the maker's routes and the providers'
// health). Models: a route per role, Kiln's proposal until saved. Providers: each key and its last
// calls, read for free, and a free key check on a click (the provider lists
// its models; no paid call). The month's cap, read only.
// Lessons: what Kiln proposes it learned of the maker's taste, and what they
// kept. Shops: the Etsy connection. Access tokens: for the HTTP API (README
// "HTTP API").
export default async function SettingsPage() {
  await connection();
  const maker = hasDatabase() ? await getCurrentMaker() : null;
  const [setup, health, keyStates, month, tokens, shop, calls, lessons] =
    await Promise.all([
      getMakerModelSetup(),
      providerHealth(maker?.id ?? null),
      providerKeyStates(),
      maker ? budget(maker.id) : Promise.resolve(null),
      maker ? listAccessTokens() : Promise.resolve(null),
      maker ? shopConnection() : Promise.resolve(null),
      maker ? recentToolCalls() : Promise.resolve([]),
      maker
        ? listLessons({ status: ["proposed", "kept"] })
        : Promise.resolve(null),
    ]);
  const mode = providerMode();
  const look = maker ? await sceneLookSetup() : null;
  // A mock run calls nothing, so every provider counts as keyed.
  const keys = {
    openai:
      mode === "mock" ||
      health.some((h) => h.provider === "openai" && h.keyPresent),
    google:
      mode === "mock" ||
      health.some((h) => h.provider === "google" && h.keyPresent),
  };
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          settings
        </span>
      </ProjectsHeader>
      <main className="mx-auto flex w-full max-w-[860px] flex-col gap-8 px-6 py-11 sm:px-8">
        <section
          id="providers"
          className="rounded-card bg-card p-6 shadow-card"
        >
          <h2
            className="font-serif text-xl text-foreground"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            Providers
          </h2>
          <p className="mt-1 mb-5 font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            {mode === "mock"
              ? "Mock mode: nothing is called or paid."
              : "Kiln runs on your own keys: paste one and it is kept sealed on this machine, then checked for free (the provider lists its models, nothing is generated). One provider is enough to start. The rest is read from the last calls Kiln made."}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {health.map((h) => (
              <div
                key={h.provider}
                className="flex min-w-0 flex-col gap-2 rounded-render border border-border-soft bg-surface-soft p-4"
              >
                <div className="font-sans text-sm font-semibold text-foreground">
                  {h.label}
                </div>
                <div
                  className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-on-surface-mid"
                  data-testid={`provider-${h.provider}-key`}
                >
                  <KeyRound className="mt-0.5 size-3.5 flex-shrink-0" />
                  {keyLine(keyStates.find((k) => k.provider === h.provider))}
                </div>
                {h.lastError ? (
                  <div className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-foreground">
                    <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-fail" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {h.lastError.message}{" "}
                      <span className="font-mono text-[0.65rem] text-on-surface-dim">
                        {when(h.lastError.at)}
                      </span>
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 font-sans text-[0.8rem] text-on-surface-mid">
                  <CircleCheck className="size-3.5 text-prov-recipe" />
                  {h.lastOkAt
                    ? `Last call that worked: ${when(h.lastOkAt)}`
                    : "No call that worked yet"}
                </div>
                {h.unlisted ? (
                  <div
                    className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-foreground"
                    data-testid={`provider-${h.provider}-unlisted`}
                  >
                    <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-fail" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      No longer offered by {h.label}:{" "}
                      {h.unlisted.models
                        .map((model) =>
                          modelLabel({ provider: h.provider, model }),
                        )
                        .join(", ")}
                      . Kiln will not run{" "}
                      {h.unlisted.models.length === 1 ? "it" : "them"}.{" "}
                      <span className="font-mono text-[0.65rem] text-on-surface-dim">
                        {when(h.unlisted.at)}
                      </span>
                    </span>
                  </div>
                ) : null}
                {h.keyPresent && mode !== "mock" ? (
                  <KeyCheck provider={h.provider} label={h.label} />
                ) : null}
                {maker && mode !== "mock" ? (
                  <ProviderKey
                    provider={h.provider}
                    label={h.label}
                    saved={keyStates.some(
                      (k) => k.provider === h.provider && k.hint !== null,
                    )}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-card bg-card p-6 shadow-card">
          <h2
            className="font-serif text-xl text-foreground"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            Models
          </h2>
          <p className="mt-1 mb-5 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            Each kind of work runs on a route: the model it starts on and, when
            you turn fallback on, the ones it may move to if a provider fails. A
            text route also has an effort: more thinking, more output and more
            time, and the estimate before spending grows with it. Nothing
            outside a route ever runs; the estimate counts the dearest model,
            and every take names the model it ran on. A card or slot can still
            pick its own model, and each agent of the chat can have its own.
          </p>
          <RoutesForm
            initial={setup.routes ?? proposeRoutes(setup.models, keys)}
            initialAgents={setup.agents}
            agentChoices={SPECIALIST_CHOICES}
            saved={setup.routes !== null}
            notes={health}
            mock={mode === "mock"}
          />
        </section>

        {look ? (
          <section id="checks" className="rounded-card bg-card p-6 shadow-card">
            <h2
              className="font-serif text-xl text-foreground"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              Checks
            </h2>
            <p className="mt-1 mb-4 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
              Kiln reads every scene&apos;s text and letters for free. A text
              model can also look at each scene for what no photo of the real
              thing could show: a glass with no foot, objects fused together,
              something floating. It is a paid call, counted in every
              scene&apos;s estimate before you generate, and a label on the
              take, never a retake: it can miss a flaw or flag a take that is
              fine, so you still decide.
            </p>
            <SceneLookSwitch on={look.on} />
            <p
              className="mt-2 font-mono text-[0.68rem] leading-snug text-on-surface-mid"
              data-testid="scene-look-plan"
            >
              {!look.on
                ? "Off: scenes land with the free check only."
                : look.plan
                  ? `${look.plan.label} (the deep route's model), about ${lookMoney(look.plan.typical)} a scene, at most ${lookMoney(look.plan.max)}.`
                  : "No model of the deep route can run here (no key), so no scene is looked at and nothing is added to an estimate."}
            </p>
          </section>
        ) : null}

        {lessons ? (
          <section
            id="lessons"
            className="rounded-card bg-card p-6 shadow-card"
          >
            <h2
              className="font-serif text-xl text-foreground"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              Lessons
            </h2>
            <p className="mt-1 mb-5 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
              What Kiln learned of your taste, per product family: from the
              reasons you give for a take, the knobs of the takes you approve
              and a listing&apos;s numbers after its photos changed. A lesson
              counts only once you keep it: then every agent follows it, and a
              scene&apos;s lesson starts that knob in your next projects of the
              family.
            </p>
            <Lessons lessons={lessons} />
          </section>
        ) : null}

        {month ? (
          <section className="rounded-card bg-card p-6 shadow-card">
            <h2
              className="font-serif text-xl text-foreground"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              This month
            </h2>
            <p className="mt-1 font-sans text-[0.8125rem] text-on-surface-mid">
              {money(fromMicros(month.spentMicros))} spent +{" "}
              {money(fromMicros(month.reservedMicros))} queued of{" "}
              {money(fromMicros(month.capMicros))}, one cap for both providers
              (calendar month, UTC).
            </p>
          </section>
        ) : null}

        {maker ? (
          <section className="rounded-card bg-card p-6 shadow-card">
            <h2
              className="font-serif text-xl text-foreground"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              Shops
            </h2>
            <p className="mt-1 mb-5 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
              Your Etsy shop, connected through Etsy: Shops ranks your listings
              by what sold, and the results loop reads orders from it.
            </p>
            <EtsyConnection setup={etsySetup()} connection={shop} manage />
          </section>
        ) : null}

        {tokens ? (
          <section className="rounded-card bg-card p-6 shadow-card">
            <h2
              className="font-serif text-xl text-foreground"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              Access tokens
            </h2>
            <p className="mt-1 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
              For scripts, agents and other systems: they send a product package
              or a colour&apos;s material photo over HTTP, and an agent drives
              the board through Kiln&apos;s MCP server. A token acts as this
              studio; make one per system, so each can be revoked on its own. A
              paid tool runs only for a token that may spend, after a quote and
              within the monthly cap.
            </p>
            <ul className="mt-3 mb-5 flex flex-col gap-1 font-mono text-[0.68rem] text-on-surface-mid">
              <li>POST /api/mcp · the MCP server, for an agent</li>
              <li>POST /api/import · a product package (JSON)</li>
              <li>
                POST /api/products/&lt;id or sku&gt;/colours/&lt;key&gt;/swatch
                · a material photo
              </li>
              <li>
                pnpm kiln validate | import | swatch | call | mcp · from a
                terminal
              </li>
            </ul>
            <AccessTokens tokens={tokens} />
            <h3 className="mt-6 mb-1 font-sans text-[0.8rem] font-semibold text-foreground">
              Recent tool calls
            </h3>
            <ToolCalls calls={calls} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

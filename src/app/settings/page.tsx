import { CircleAlert, CircleCheck, KeyRound } from "lucide-react";
import { connection } from "next/server";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { AccessTokens } from "@/components/settings/access-tokens";
import { KeyCheck } from "@/components/settings/key-check";
import { ModelsForm } from "@/components/settings/models-form";
import { EtsyConnection } from "@/components/shops/etsy-connection";
import { fromMicros } from "@/domain/generation-cost";
import { hasDatabase } from "@/lib/db";
import { providerMode } from "@/providers/mode";
import { listAccessTokens } from "@/server/access-tokens";
import { budget } from "@/server/generation-repository";
import { getCurrentMaker, getMakerModels } from "@/server/maker-repository";
import { providerHealth } from "@/server/provider-health";
import { etsySetup, shopConnection } from "@/server/shop-connection";

const money = (usd: number) => `$${usd.toFixed(2)}`;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Settings (per request: it reads the maker's defaults and the providers'
// health). Models: the default per kind. Providers: each key and its last
// calls, read for free, and a free key check on a click (the provider lists
// its models; no paid call). The month's cap, read only.
// Shops: the Etsy connection. Access tokens: for the HTTP API (README "HTTP
// API").
export default async function SettingsPage() {
  await connection();
  const maker = hasDatabase() ? await getCurrentMaker() : null;
  const [models, health, month, tokens, shop] = await Promise.all([
    getMakerModels(),
    providerHealth(maker?.id ?? null),
    maker ? budget(maker.id) : Promise.resolve(null),
    maker ? listAccessTokens() : Promise.resolve(null),
    maker ? shopConnection() : Promise.resolve(null),
  ]);
  const mode = providerMode();
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          settings
        </span>
      </ProjectsHeader>
      <main className="mx-auto flex w-full max-w-[860px] flex-col gap-8 px-6 py-11 sm:px-8">
        <section className="rounded-card bg-card p-6 shadow-card">
          <h2
            className="font-serif text-xl italic text-foreground"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            Models
          </h2>
          <p className="mt-1 mb-5 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            The model each kind of work starts on. Every card and slot can pick
            its own; every generation names its model and price before it is
            paid. Kiln never switches provider on its own.
          </p>
          <ModelsForm initial={models} notes={health} />
        </section>

        <section className="rounded-card bg-card p-6 shadow-card">
          <h2
            className="font-serif text-xl italic text-foreground"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            Providers
          </h2>
          <p className="mt-1 mb-5 font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            {mode === "mock"
              ? "Mock mode: nothing is called or paid."
              : "Read from the last calls Kiln made. Checking a key is free: the provider lists its models, nothing is generated."}
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
                <div className="flex items-center gap-2 font-sans text-[0.8rem] text-on-surface-mid">
                  <KeyRound className="size-3.5" />
                  {h.keyPresent
                    ? "API key set"
                    : `No API key — set ${h.provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY"}`}
                </div>
                {h.lastError ? (
                  <div className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-foreground">
                    <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-prov-local" />
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
                {h.keyPresent && mode !== "mock" ? (
                  <KeyCheck provider={h.provider} label={h.label} />
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {month ? (
          <section className="rounded-card bg-card p-6 shadow-card">
            <h2
              className="font-serif text-xl italic text-foreground"
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
              className="font-serif text-xl italic text-foreground"
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
              className="font-serif text-xl italic text-foreground"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              Access tokens
            </h2>
            <p className="mt-1 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
              For scripts, agents and other systems: they send a product package
              or a colour&apos;s material photo over HTTP, with no file picker.
              A token acts as this studio; make one per system, so each can be
              revoked on its own.
            </p>
            <ul className="mt-3 mb-5 flex flex-col gap-1 font-mono text-[0.68rem] text-on-surface-mid">
              <li>POST /api/import · a product package (JSON)</li>
              <li>
                POST /api/products/&lt;id or sku&gt;/colours/&lt;key&gt;/swatch
                · a material photo
              </li>
              <li>pnpm kiln validate | import | swatch · from a terminal</li>
            </ul>
            <AccessTokens tokens={tokens} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

import { CircleAlert, CircleCheck } from "lucide-react";
import { cookies } from "next/headers";
import { connection as dynamic } from "next/server";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { BestSellers } from "@/components/shops/best-sellers";
import { EtsyConnection } from "@/components/shops/etsy-connection";
import { OtherShops } from "@/components/shops/other-shops";
import { RankWindow } from "@/domain/shop-ranking";
import { hasDatabase } from "@/lib/db";
import { EtsyError } from "@/providers/shop/etsy";
import {
  type ConnectProblem,
  etsySetup,
  SHOPS_NOTE_COOKIE,
  ShopNeedsReconnect,
  shopConnection,
} from "@/server/shop-connection";
import {
  type BestSellersView,
  watchedShops,
  yourBestSellers,
} from "@/server/shop-ranking";

const HEADING = "font-serif text-xl italic text-foreground";

const PROBLEMS: Record<ConnectProblem, string> = {
  "not-set-up": "Kiln is not set up to connect Etsy yet: see below.",
  expired:
    "The connection took too long or started in another browser: connect again.",
  state:
    "Etsy's answer did not match the connection Kiln started: connect again.",
  denied: "The connection was not approved on Etsy; nothing was kept.",
  etsy: "Etsy refused the connection.",
};

const said = (error: unknown) =>
  error instanceof EtsyError
    ? `Etsy said: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);

// Shops (ROADMAP Phase 20; Luis, 2026-10-27): the maker's best sellers, read
// from their connected Etsy shop's orders, and the other shops they compare
// theirs with, from Etsy's public numbers. Read per request through Etsy's
// API, never its pages.
export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await dynamic();
  const params = await searchParams;
  const window = RankWindow.parse(params.window);
  const fresh = params.fresh === "1";
  const setup = etsySetup();
  const connected = hasDatabase() ? await shopConnection() : null;

  let best: BestSellersView | null = null;
  let bestError: string | null = null;
  if (connected && !connected.needsReconnect) {
    try {
      best = await yourBestSellers(window, { fresh });
    } catch (error) {
      bestError =
        error instanceof ShopNeedsReconnect ? error.message : said(error);
    }
  }
  // A failed read may have found the access revoked.
  const shop = bestError && connected ? await shopConnection() : connected;

  let others: Awaited<ReturnType<typeof watchedShops>> = null;
  let othersError: string | null = null;
  if (setup.publicReads && hasDatabase()) {
    try {
      others = await watchedShops({ fresh });
    } catch (error) {
      othersError = said(error);
    }
  }

  const problem =
    typeof params.connect === "string" && params.connect in PROBLEMS
      ? PROBLEMS[params.connect as ConnectProblem]
      : null;
  const note = (await cookies()).get(SHOPS_NOTE_COOKIE)?.value ?? null;

  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          shops
        </span>
      </ProjectsHeader>
      <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-4 py-11 sm:px-8">
        {params.connected === "1" && shop && !shop.needsReconnect ? (
          <p
            className="flex items-center gap-2 rounded-render border border-prov-recipe/40 bg-card px-4 py-3 font-sans text-sm text-foreground"
            data-testid="shops-connected"
            aria-live="polite"
          >
            <CircleCheck className="size-4 text-prov-recipe" />
            Connected {shop.shopName}. Kiln reads its orders from here on.
          </p>
        ) : null}
        {problem ? (
          <p
            className="flex items-start gap-2 rounded-render border border-prov-local/40 bg-card px-4 py-3 font-sans text-sm text-foreground"
            data-testid="shops-connect-problem"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 flex-shrink-0 text-prov-local" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {problem}
              {params.connect === "etsy" && note ? ` ${note}` : ""}
            </span>
          </p>
        ) : null}

        <section className="rounded-card bg-card p-6 shadow-card">
          <h2
            className={HEADING}
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            {shop && !shop.needsReconnect
              ? `${shop.shopName}: best sellers`
              : "Your best sellers"}
          </h2>
          <p className="mt-1 mb-5 max-w-[620px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            What sold, listing by listing, from your shop&apos;s own orders: the
            listings to refresh first.
          </p>
          {best ? (
            <BestSellers view={best} />
          ) : (
            <div className="flex flex-col gap-4">
              {bestError ? (
                <p
                  className="flex items-start gap-2 font-sans text-[0.8rem] text-foreground"
                  role="alert"
                >
                  <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-prov-local" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {bestError}
                  </span>
                </p>
              ) : null}
              {!bestError || shop?.needsReconnect ? (
                <EtsyConnection setup={setup} connection={shop} />
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-card bg-card p-6 shadow-card">
          <h2
            className={HEADING}
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            Other shops
          </h2>
          <p className="mt-1 mb-5 max-w-[620px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            Shops to compare yours with, by lifetime sales. Etsy gives another
            shop&apos;s sales only as a total, so its listings rank by
            favourites.
          </p>
          {others ? (
            <OtherShops standings={others.standings} failed={others.failed} />
          ) : othersError ? (
            <p
              className="font-mono text-[0.65rem] text-prov-local"
              role="alert"
            >
              {othersError}
            </p>
          ) : (
            <p className="font-sans text-[0.8rem] text-on-surface-mid">
              Needs Kiln&apos;s Etsy app keys (<code>ETSY_API_KEY</code>,{" "}
              <code>ETSY_SHARED_SECRET</code>) in <code>.env</code>; no shop has
              to be connected.
            </p>
          )}
        </section>

        <p className="font-sans text-[0.7rem] leading-relaxed text-on-surface-dim">
          The term &apos;Etsy&apos; is a trademark of Etsy, Inc. This
          application uses the Etsy API but is not endorsed or certified by
          Etsy, Inc.
        </p>
      </main>
    </div>
  );
}

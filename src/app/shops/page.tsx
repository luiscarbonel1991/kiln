import { ArrowRight, CircleAlert, CircleCheck, FilePen } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection as dynamic } from "next/server";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { BestSellers } from "@/components/shops/best-sellers";
import { EtsyConnection } from "@/components/shops/etsy-connection";
import { OtherShops } from "@/components/shops/other-shops";
import { Segmented } from "@/components/shops/segmented";
import {
  RankBy,
  RankWindow,
  SHOP_RANK_BY,
  ShopRankBy,
} from "@/domain/shop-ranking";
import { hasDatabase } from "@/lib/db";
import { SHOP_RANK_LABEL, type ShopsQuery, shopsHref } from "@/lib/shops-view";
import { EtsyError } from "@/providers/shop/etsy";
import { requireMaker } from "@/server/session";
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

const HEADING = "font-serif text-xl text-foreground";
const LEAD =
  "mt-1 max-w-[620px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid";

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

// Shops (Luis, 2026-10-27): the maker's best sellers, read from their connected
// Etsy shop's orders, and the other shops they compare theirs with, from Etsy's
// public numbers. Read per request through Etsy's API, never its pages.
export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireMaker();
  await dynamic();
  const params = await searchParams;
  const query: ShopsQuery = {
    window: RankWindow.parse(params.window),
    by: RankBy.parse(params.by),
    shops: ShopRankBy.parse(params.shops),
  };
  const fresh = params.fresh === "1";
  const setup = etsySetup();
  const connected = hasDatabase() ? await shopConnection() : null;

  let best: BestSellersView | null = null;
  let bestError: string | null = null;
  if (connected && !connected.needsReconnect) {
    try {
      best = await yourBestSellers(query.window, { by: query.by, fresh });
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
      others = await watchedShops({ by: query.shops, fresh });
    } catch (error) {
      othersError = said(error);
    }
  }

  const problem =
    typeof params.connect === "string" && params.connect in PROBLEMS
      ? PROBLEMS[params.connect as ConnectProblem]
      : null;
  const note = (await cookies()).get(SHOPS_NOTE_COOKIE)?.value ?? null;

  const live = shop && !shop.needsReconnect ? shop : null;

  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          shops
        </span>
      </ProjectsHeader>
      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-4 py-10 sm:px-8">
        <div>
          <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
            {live ? (
              <a
                href={live.shopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {live.shopName} on Etsy
              </a>
            ) : (
              "Shops"
            )}
          </p>
          <h1
            className="mt-2 font-serif text-[1.875rem] font-semibold leading-tight text-foreground"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            What sells, and what to refresh first.
          </h1>
        </div>

        {params.connected === "1" && live ? (
          <p
            className="flex items-center gap-2 rounded-render border border-prov-recipe/40 bg-card px-4 py-3 font-sans text-sm text-foreground"
            data-testid="shops-connected"
            aria-live="polite"
          >
            <CircleCheck className="size-4 text-prov-recipe" />
            Connected {live.shopName}. Kiln reads its orders
            {live.draftsAllowed ? " and may write drafts" : ""} from here on.
          </p>
        ) : null}
        {problem ? (
          <p
            className="flex items-start gap-2 rounded-render border border-fail/40 bg-card px-4 py-3 font-sans text-sm text-foreground"
            data-testid="shops-connect-problem"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 flex-shrink-0 text-fail" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {problem}
              {params.connect === "etsy" && note ? ` ${note}` : ""}
            </span>
          </p>
        ) : null}

        <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
          <h2
            className={HEADING}
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            Your best sellers
          </h2>
          <p className={`${LEAD} mb-5`}>
            What sold, listing by listing, from your shop&apos;s own orders. The
            ones at the top are the photos worth refreshing first.
          </p>
          {best ? (
            <BestSellers view={best} query={query} />
          ) : (
            <div className="flex flex-col gap-4">
              {bestError ? (
                <p
                  className="flex items-start gap-2 font-sans text-[0.8rem] text-foreground"
                  role="alert"
                >
                  <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-fail" />
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

        {live ? (
          <Link
            href="/shops/drafts"
            className="flex items-center gap-3 rounded-card bg-card p-5 shadow-card transition-colors hover:bg-secondary sm:p-6"
            data-testid="shops-drafts"
          >
            <FilePen className="size-5 flex-shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span
                className={`block ${HEADING}`}
                style={{ fontVariationSettings: "'opsz' 40" }}
              >
                Drafts
              </span>
              <span className="block font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
                Make a draft from a project, or change one already in{" "}
                {live.shopName}. Kiln never publishes: you do, in Etsy.
              </span>
            </span>
            <ArrowRight className="size-4 flex-shrink-0 text-on-surface-dim" />
          </Link>
        ) : null}

        <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                className={HEADING}
                style={{ fontVariationSettings: "'opsz' 40" }}
              >
                Other shops
              </h2>
              <p className={LEAD}>
                Shops to set beside yours. Etsy gives another shop&apos;s
                numbers only as totals: its reviews in the past year are the
                nearest to its pace now.
              </p>
            </div>
            {others && others.standings.length > 1 ? (
              <Segmented
                label="Rank by"
                testId="other-shops-by"
                options={SHOP_RANK_BY.map((by) => ({
                  id: by,
                  label: SHOP_RANK_LABEL[by],
                  current: by === others?.by,
                  href: shopsHref(query, { shops: by }),
                }))}
              />
            ) : null}
          </div>
          {others ? (
            <OtherShops
              standings={others.standings}
              failed={others.failed}
              yourShopId={others.yourShopId}
              by={others.by}
            />
          ) : othersError ? (
            <p className="font-mono text-[0.65rem] text-fail" role="alert">
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

        <p
          className="font-sans text-[0.75rem] leading-relaxed text-on-surface-mid"
          data-testid="etsy-notice"
        >
          The term &apos;Etsy&apos; is a trademark of Etsy, Inc. This
          Application uses Etsy&apos;s API, but is not endorsed or certified by
          Etsy.
        </p>
      </main>
    </div>
  );
}

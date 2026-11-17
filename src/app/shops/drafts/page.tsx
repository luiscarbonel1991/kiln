import { ArrowRight, CircleAlert, ExternalLink, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { connection as dynamic } from "next/server";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { AllowDrafts, DraftRules } from "@/components/shops/draft-rules";
import { EtsyConnection } from "@/components/shops/etsy-connection";
import { ListingThumb } from "@/components/shops/listing-thumb";
import { hasDatabase } from "@/lib/db";
import { priceLabel, whenLabel } from "@/lib/drafts-view";
import { CATALOG } from "@/lib/recipes";
import {
  DraftRefusal,
  type DraftSummary,
  draftableProjects,
  listDrafts,
} from "@/server/etsy-drafts";
import { requireMaker } from "@/server/session";
import { etsySetup, shopConnection } from "@/server/shop-connection";

const HEADING = "font-serif text-xl text-foreground";
const LEAD =
  "mt-1 max-w-[620px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid";

// The drafts of the maker's Etsy shop (Luis, 2026-11-02): the ones there now,
// read from Etsy per request, and the projects a new one can be made from.
// Nothing here publishes.
export default async function DraftsPage() {
  await requireMaker();
  await dynamic();
  const setup = etsySetup();
  const shop = hasDatabase() ? await shopConnection() : null;
  const live = shop && !shop.needsReconnect ? shop : null;
  let drafts: DraftSummary[] = [];
  let complete = true;
  let error: string | null = null;
  if (live) {
    try {
      const listed = await listDrafts();
      drafts = listed.drafts;
      complete = listed.complete;
    } catch (e) {
      error =
        e instanceof DraftRefusal || e instanceof Error ? e.message : String(e);
    }
  }
  const projects = live ? await draftableProjects() : [];
  const destinationName = (id: string) =>
    CATALOG.destinations.find((d) => d.id === id)?.name ?? id;

  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          <Link href="/shops" className="hover:underline">
            shops
          </Link>{" "}
          / drafts
        </span>
      </ProjectsHeader>
      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-4 py-10 sm:px-8">
        <div>
          <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
            {live ? `${live.shopName} on Etsy` : "Shops"}
          </p>
          <h1
            className="mt-2 font-serif text-[1.875rem] font-semibold leading-tight text-foreground"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            Drafts, ready for you to publish.
          </h1>
        </div>

        {!live ? (
          <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
            <EtsyConnection setup={setup} connection={shop} />
          </section>
        ) : (
          <>
            <DraftRules />
            {!live.draftsAllowed ? (
              <AllowDrafts shopName={live.shopName} />
            ) : null}

            <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
              <h2
                className={HEADING}
                style={{ fontVariationSettings: "'opsz' 40" }}
              >
                In your shop
              </h2>
              <p className={`${LEAD} mb-5`}>
                Every draft of {live.shopName}, newest change first, whoever
                made it. Open one to change it.
              </p>
              {error ? (
                <p
                  className="flex items-start gap-2 font-sans text-[0.8rem] text-foreground"
                  role="alert"
                >
                  <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-fail" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {error}
                  </span>
                </p>
              ) : drafts.length === 0 ? (
                <p className="rounded-render border border-border-soft bg-surface-soft p-4 font-sans text-sm text-on-surface-mid">
                  No drafts in {live.shopName} now.
                </p>
              ) : (
                <ul
                  className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-render border border-border-soft"
                  data-testid="drafts-list"
                >
                  {drafts.map((d) => (
                    <li
                      key={d.listingId}
                      className="flex flex-wrap items-center gap-3 bg-card px-3 py-3 sm:flex-nowrap"
                    >
                      <ListingThumb src={d.photo ?? null} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Link
                          href={`/shops/drafts/${d.listingId}`}
                          className="truncate font-sans text-[0.875rem] font-semibold text-foreground hover:text-primary"
                          data-testid={`draft-${d.listingId}`}
                        >
                          {d.title}
                        </Link>
                        <span className="font-mono text-[0.65rem] text-on-surface-dim">
                          {priceLabel(d.price, d.currency)}
                          {d.quantity !== undefined
                            ? ` · ${d.quantity} in stock`
                            : ""}
                          {` · ${d.photos} photo${d.photos === 1 ? "" : "s"}`}
                          {d.updatedAt
                            ? ` · changed ${whenLabel(d.updatedAt)}`
                            : ""}
                        </span>
                        {d.madeBy ? (
                          <Link
                            href={`/projects/${d.madeBy.projectId}`}
                            className="truncate font-sans text-[0.75rem] text-prov-recipe hover:underline"
                          >
                            Made by Kiln from {d.madeBy.projectName}
                          </Link>
                        ) : null}
                      </div>
                      <a
                        href={d.editorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-sans text-[0.75rem] font-semibold text-on-surface-mid hover:text-foreground"
                      >
                        Etsy&apos;s editor <ExternalLink className="size-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {!complete ? (
                <p className="mt-3 font-sans text-[0.75rem] text-on-surface-mid">
                  Showing the newest {drafts.length}; the rest are in Etsy.
                </p>
              ) : null}
            </section>

            <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
              <h2
                className={HEADING}
                style={{ fontVariationSettings: "'opsz' 40" }}
              >
                A new draft from a project
              </h2>
              <p className={`${LEAD} mb-5`}>
                Its listing text, its approved photos and the product&apos;s
                price. You see all of it before anything is sent.
              </p>
              {projects.length === 0 ? (
                <p className="rounded-render border border-border-soft bg-surface-soft p-4 font-sans text-sm text-on-surface-mid">
                  No project has an Etsy listing yet: start a listing kit for
                  Etsy from{" "}
                  <Link
                    href="/projects/new"
                    className="text-primary hover:underline"
                  >
                    New project
                  </Link>
                  .
                </p>
              ) : (
                <ul
                  className="flex flex-col gap-2"
                  data-testid="draftable-projects"
                >
                  {projects.map((p) => (
                    <li key={`${p.projectId}-${p.destinationId}`}>
                      <Link
                        href={`/shops/drafts/new?project=${p.projectId}&destination=${p.destinationId}`}
                        className="flex items-center gap-3 rounded-render bg-surface-soft px-4 py-3 font-sans text-[0.85rem] text-foreground transition-colors hover:bg-secondary"
                      >
                        <FilePlus2 className="size-4 flex-shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate">
                          {p.name}
                          <span className="text-on-surface-mid">
                            {" "}
                            · {destinationName(p.destinationId)} · changed{" "}
                            {whenLabel(p.updatedAt)}
                          </span>
                        </span>
                        <ArrowRight className="size-4 flex-shrink-0 text-on-surface-dim" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

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

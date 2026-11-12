import { ArrowDown, ArrowRight, PenLine, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { HomeProjects } from "@/components/home/home-projects";
import { HomeResults } from "@/components/home/home-results";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { fromMicros } from "@/domain/generation-cost";
import { buyerSizeLabel, type Product } from "@/domain/product";
import { hasDatabase } from "@/lib/db";
import { providerMode } from "@/providers/mode";
import { budget } from "@/server/generation-repository";
import { homeStats, type ProjectStats } from "@/server/home-repository";
import { followedListings } from "@/server/listing-results";
import { getCurrentMaker } from "@/server/maker-repository";
import { listProducts } from "@/server/product-repository";
import { listProjects } from "@/server/project-repository";

const money = (micros: number) => `$${fromMicros(micros).toFixed(2)}`;

// What a planned project kept and spent, in a line.
function projectDetail(stats: ProjectStats): string {
  const kept =
    stats.slots === 0
      ? "nothing to generate"
      : `${stats.approved} of ${stats.slots} approved`;
  if (stats.spentMicros === 0) return kept;
  const each =
    stats.approved > 0
      ? ` · ${money(stats.spentMicros / stats.approved)} each`
      : "";
  return `${kept} · ${money(stats.spentMicros)} spent${each}`;
}

// The maker's work: where they left off, their projects and their products.
// What Kiln does is told on the public page (/); this is where a maker lands
// from it. Nothing here calls a model or a shop. Rendered per request.
export default async function ProjectsPage() {
  await connection();
  if (!hasDatabase()) {
    return (
      <div className="flex min-h-full flex-col">
        <ProjectsHeader />
        <main className={MAIN}>
          <div className="flex flex-col items-start gap-3 rounded-card bg-card p-6 shadow-card">
            <h1 className="font-serif text-xl italic text-foreground">
              Kiln has no database yet
            </h1>
            <p className="font-sans text-sm text-on-surface-mid">
              Projects and products are kept in Postgres. Set DATABASE_URL and
              run the migrations, as the README describes, then reload.
            </p>
          </div>
        </main>
      </div>
    );
  }
  const maker = await getCurrentMaker();
  const [projects, products, stats, spend, listings] = await Promise.all([
    listProjects(),
    listProducts(),
    homeStats(maker.id),
    budget(maker.id),
    followedListings(),
  ]);
  const followed = listings.filter((l) => l.view.following);
  const mock = providerMode() === "mock";
  const details = Object.fromEntries(
    projects.flatMap((p) => {
      const s = stats.projects.get(p.id);
      return p.planned && s ? [[p.id, projectDetail(s)]] : [];
    }),
  );
  const returning = projects.length > 0 || products.length > 0;
  const latest = projects[0];
  const next = latest
    ? {
        href: latest.planned
          ? `/projects/${latest.id}`
          : `/studio?open=${encodeURIComponent(latest.id)}`,
        label: `Continue ${short(latest.name)}`,
      }
    : null;

  const tiles = [
    {
      label: "This month",
      value: mock ? "mock mode" : money(spend.spentMicros),
      note: mock
        ? "nothing is paid or counted"
        : `of ${money(spend.capMicros)} (calendar month, UTC)`,
    },
    {
      label: "Approved this month",
      value: String(stats.monthApproved),
      note: "scenes and videos kept",
    },
    {
      label: "Per approved output",
      value:
        !mock && stats.monthApproved > 0
          ? money(spend.spentMicros / stats.monthApproved)
          : "—",
      note: "this month's spend over what was kept",
    },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader />
      <main className={MAIN}>
        <Opening maker={maker.name} next={next} returning={returning} />

        {returning ? (
          <section
            className="flex flex-col gap-6"
            data-testid="home-continue"
            aria-labelledby="home-continue-title"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2
                id="home-continue-title"
                className="font-serif text-xl italic text-foreground"
              >
                Where you left off
              </h2>
              {projects.length > RECENT ? (
                <a
                  href="#projects"
                  className="inline-flex items-center gap-1 font-sans text-[0.8rem] font-semibold text-primary hover:underline"
                >
                  All {projects.length} projects{" "}
                  <ArrowDown className="size-3.5" />
                </a>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {tiles.map((t) => (
                <div
                  key={t.label}
                  className="flex flex-col gap-1 rounded-card bg-card p-5 shadow-card"
                >
                  <span className="font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
                    {t.label}
                  </span>
                  <span className="font-serif text-2xl italic text-foreground">
                    {t.value}
                  </span>
                  <span className="font-mono text-[0.65rem] text-on-surface-mid">
                    {t.note}
                  </span>
                </div>
              ))}
            </div>
            {projects.length > 0 ? (
              <HomeProjects
                projects={projects.slice(0, RECENT)}
                details={details}
              />
            ) : null}
            {followed.length > 0 ? (
              <div className="flex flex-col gap-3" data-testid="home-results">
                <div className="flex flex-col gap-1">
                  <h3 className="font-serif text-lg italic text-foreground">
                    Results
                  </h3>
                  <p className="font-sans text-[0.8125rem] text-on-surface-mid">
                    Each delivered listing, read from your shop's stats before
                    the new photos and 14 and 30 days after.
                  </p>
                </div>
                <HomeResults listings={followed} />
              </div>
            ) : null}
          </section>
        ) : null}

        {returning ? (
          <>
            <section id="projects" className="flex scroll-mt-20 flex-col gap-4">
              <h2 className="font-serif text-xl italic text-foreground">
                Projects
              </h2>
              {projects.length > 0 ? (
                <HomeProjects projects={projects} details={details} />
              ) : (
                <div className="flex flex-col items-start gap-3 rounded-card bg-card p-6 shadow-card">
                  <p className="font-sans text-sm text-on-surface-mid">
                    No projects yet. Start from a product: the plan shows every
                    frame and what it costs before anything is paid.
                  </p>
                  <Link
                    href="/projects/new"
                    className="font-sans text-sm font-semibold text-primary hover:underline"
                  >
                    Start your first project
                  </Link>
                </div>
              )}
            </section>
            <Products products={products} />
          </>
        ) : null}
      </main>
    </div>
  );
}

const MAIN =
  "mx-auto flex w-full max-w-[1120px] flex-col gap-14 px-6 py-10 sm:gap-16 sm:px-8";
const RECENT = 3;

const short = (name: string) =>
  name.length > 36 ? `${name.slice(0, 35).trimEnd()}…` : name;

// The page's opening: whose work this is and the way back into it. A maker
// with nothing yet is told how to begin.
function Opening({
  maker,
  next,
  returning,
}: {
  maker: string;
  next: { href: string; label: string } | null;
  returning: boolean;
}) {
  return (
    <section className="flex flex-col gap-5 pt-4">
      <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
        {maker}
      </p>
      <h1
        className="font-serif text-[2.4rem] font-semibold leading-[1.04] text-foreground sm:text-[3rem]"
        style={{ fontVariationSettings: "'opsz' 144" }}
      >
        {returning ? "Your projects" : "Start with one product."}
      </h1>
      {returning ? null : (
        <p className="max-w-[520px] font-sans text-[1rem] leading-relaxed text-on-surface-mid">
          Type it in, start from a photo or a design file, or import your
          catalog. The plan shows every frame and what it costs before anything
          is paid.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {next ? (
          <Link
            href={next.href}
            data-testid="home-next"
            className="inline-flex h-10 items-center gap-2 rounded-field bg-primary px-4 font-sans text-[0.875rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
          >
            {next.label} <ArrowRight className="size-4" />
          </Link>
        ) : null}
        <Link
          href="/projects/new"
          data-testid="home-start"
          className={
            next
              ? "inline-flex h-10 items-center gap-2 rounded-field border border-border bg-card px-4 font-sans text-[0.875rem] font-semibold text-foreground transition-colors hover:bg-secondary"
              : "inline-flex h-10 items-center gap-2 rounded-field bg-primary px-4 font-sans text-[0.875rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85"
          }
        >
          <Plus className="size-4" />{" "}
          {returning ? "New project" : "Add a product"}
        </Link>
      </div>
    </section>
  );
}

function Products({ products }: { products: Product[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-serif text-xl italic text-foreground">Products</h2>
      {products.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <div
              key={p.id}
              className="flex flex-col gap-2 rounded-card bg-card p-5 shadow-card"
            >
              <span className="font-mono text-[0.625rem] text-on-surface-dim">
                {p.sku}
              </span>
              <span className="font-serif text-lg italic leading-tight text-foreground">
                {p.name}
              </span>
              <span className="font-sans text-[0.8rem] text-on-surface-mid">
                {buyerSizeLabel(p)} · {p.material}
              </span>
              <span className="flex gap-1.5 pt-1">
                {p.colours.map((c) => (
                  <span
                    key={c.key}
                    title={c.inStock ? c.name : `${c.name} (out of stock)`}
                    className="size-4 rounded-swatch border border-border"
                    style={{
                      backgroundColor: c.face,
                      opacity: c.inStock ? 1 : 0.35,
                    }}
                  />
                ))}
              </span>
              <span className="flex flex-wrap items-center gap-4 pt-1">
                <Link
                  href={`/projects/new?product=${encodeURIComponent(p.id)}`}
                  className="inline-flex items-center gap-1 font-sans text-[0.75rem] font-semibold text-primary hover:underline"
                >
                  <Plus className="size-3" /> New project
                </Link>
                <Link
                  href={`/products/${encodeURIComponent(p.id)}`}
                  className="inline-flex items-center gap-1 font-sans text-[0.75rem] font-semibold text-on-surface-mid hover:text-foreground hover:underline"
                >
                  <PenLine className="size-3" /> Edit
                </Link>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-card bg-card p-6 shadow-card">
          <p className="font-sans text-sm text-on-surface-mid">
            No products yet: type one in, start from a photo or a design file,
            or import your catalog.
          </p>
          <Link
            href="/projects/new"
            className="font-sans text-sm font-semibold text-primary hover:underline"
          >
            Add a product
          </Link>
        </div>
      )}
    </section>
  );
}

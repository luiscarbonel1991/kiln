import { PenLine, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { HomeProjects } from "@/components/home/home-projects";
import { HomeResults } from "@/components/home/home-results";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { fromMicros } from "@/domain/generation-cost";
import { buyerSizeLabel } from "@/domain/product";
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

// Home (ROADMAP screen 1): where a returning maker lands — the projects in
// progress, the products, and this month's spend with its cost per approved
// output (what a maker measures, not cost per output made). Nothing here
// calls a model. Rendered per request.
export default async function HomePage() {
  await connection();
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
      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-6 py-10 sm:px-8">
        <div>
          <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
            {maker.name}
          </p>
          <h1
            className="mt-2 font-serif text-[1.875rem] font-semibold leading-tight text-foreground"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            Your products and what's in progress.
          </h1>
        </div>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        </section>

        {followed.length > 0 ? (
          <section className="flex flex-col gap-4" data-testid="home-results">
            <div className="flex flex-col gap-1">
              <h2 className="font-serif text-xl italic text-foreground">
                Results
              </h2>
              <p className="font-sans text-[0.8125rem] text-on-surface-mid">
                Each delivered listing, read from your shop's stats before the
                new photos and 14 and 30 days after.
              </p>
            </div>
            <HomeResults listings={followed} />
          </section>
        ) : null}

        <section className="flex flex-col gap-4">
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

        <section className="flex flex-col gap-4">
          <h2 className="font-serif text-xl italic text-foreground">
            Products
          </h2>
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
                No products yet: type one in, start from a photo or a design
                file, or import your catalog.
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
      </main>
    </div>
  );
}

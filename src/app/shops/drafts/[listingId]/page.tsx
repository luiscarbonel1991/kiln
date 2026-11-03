import { CircleAlert, ExternalLink } from "lucide-react";
import Link from "next/link";
import { connection as dynamic } from "next/server";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { DraftEditor } from "@/components/shops/draft-editor";
import { DraftRules } from "@/components/shops/draft-rules";
import { WRITE_LABEL, WRITE_STATUS, whenLabel } from "@/lib/drafts-view";
import {
  type DraftDetail,
  draftChoices,
  draftDetail,
} from "@/server/etsy-drafts";

// One listing of the maker's shop, as Etsy has it now: a draft can be changed
// here (each save shows what changes first); a live listing only read. Below,
// every write Kiln sent to it.
export default async function DraftPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  await dynamic();
  const { listingId } = await params;
  const id = Number(listingId);
  let draft: DraftDetail | null = null;
  let categories: { id: number; path: string[] }[] = [];
  let error: string | null = null;
  try {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Which listing?");
    draft = await draftDetail(id);
    categories = draft.editable
      ? (await draftChoices()).categories.map((c) => ({
          id: c.id,
          path: c.path,
        }))
      : draft.category && draft.taxonomyId
        ? [{ id: draft.taxonomyId, path: draft.category }]
        : [];
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          <Link href="/shops/drafts" className="hover:underline">
            drafts
          </Link>{" "}
          / {listingId}
        </span>
      </ProjectsHeader>
      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-4 py-10 sm:px-8">
        {draft ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
                  {draft.state === "draft" ? "Draft" : draft.state}{" "}
                  {draft.listingId}
                </p>
                <h1
                  className="mt-2 font-serif text-[1.6rem] font-semibold leading-tight text-foreground [overflow-wrap:anywhere]"
                  style={{ fontVariationSettings: "'opsz' 144" }}
                >
                  {draft.title}
                </h1>
              </div>
              <a
                href={draft.editorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-sans text-[0.8rem] font-semibold text-primary hover:underline"
              >
                Open in Etsy&apos;s editor <ExternalLink className="size-3.5" />
              </a>
            </div>
            <DraftRules />
            <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
              <DraftEditor draft={draft} categories={categories} />
            </section>
            <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
              <h2
                className="font-serif text-xl italic text-foreground"
                style={{ fontVariationSettings: "'opsz' 40" }}
              >
                What Kiln sent
              </h2>
              {draft.log.length === 0 ? (
                <p className="mt-2 font-sans text-[0.8rem] text-on-surface-mid">
                  Nothing yet: Kiln has not changed this listing.
                </p>
              ) : (
                <ul
                  className="mt-3 flex flex-col gap-1.5"
                  data-testid="draft-log"
                >
                  {draft.log.map((w) => (
                    <li
                      key={w.id}
                      className="flex flex-wrap items-baseline gap-x-2 font-sans text-[0.8rem] text-foreground"
                    >
                      <span className="font-mono text-[0.65rem] text-on-surface-dim">
                        {whenLabel(w.at)}
                      </span>
                      <span>{WRITE_LABEL[w.action] ?? w.action}</span>
                      <span
                        className={
                          w.status === "done"
                            ? "text-prov-recipe"
                            : "text-prov-local"
                        }
                      >
                        {WRITE_STATUS[w.status] ?? w.status}
                      </span>
                      <span className="text-on-surface-mid">· {w.by}</span>
                      {w.error ? (
                        <span className="w-full font-mono text-[0.65rem] text-prov-local [overflow-wrap:anywhere]">
                          {w.error}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p
            className="flex items-start gap-2 rounded-render border border-prov-local/40 bg-card px-4 py-3 font-sans text-sm text-foreground"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 flex-shrink-0 text-prov-local" />
            <span className="[overflow-wrap:anywhere]">{error}</span>
          </p>
        )}
        <p className="font-sans text-[0.75rem] leading-relaxed text-on-surface-mid">
          The term &apos;Etsy&apos; is a trademark of Etsy, Inc. This
          Application uses Etsy&apos;s API, but is not endorsed or certified by
          Etsy.
        </p>
      </main>
    </div>
  );
}

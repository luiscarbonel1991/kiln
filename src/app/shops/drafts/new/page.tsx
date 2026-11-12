import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { connection as dynamic } from "next/server";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { DraftPreviewForm } from "@/components/shops/draft-preview";
import { DraftRules } from "@/components/shops/draft-rules";
import {
  type DraftPreview,
  DraftRefusal,
  draftChoices,
  previewDraft,
} from "@/server/etsy-drafts";

// A new Etsy draft from a project's destination: everything it would carry,
// seen and completed before anything is sent.
export default async function NewDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await dynamic();
  const { project, destination } = await searchParams;
  const projectId = typeof project === "string" ? project : "";
  const destinationId = typeof destination === "string" ? destination : "";
  let preview: DraftPreview | null = null;
  let choices: Awaited<ReturnType<typeof draftChoices>> | null = null;
  let error: string | null = null;
  try {
    if (!projectId || !destinationId) {
      throw new DraftRefusal("Pick a project on the Drafts page.");
    }
    [preview, choices] = await Promise.all([
      previewDraft(projectId, destinationId),
      draftChoices(),
    ]);
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
          / new
        </span>
      </ProjectsHeader>
      <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-4 py-10 sm:px-8">
        <div>
          <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
            {preview ? `A draft for ${preview.shopName}` : "A new draft"}
          </p>
          <h1
            className="mt-2 font-serif text-[1.875rem] font-semibold leading-tight text-foreground [overflow-wrap:anywhere]"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            {preview ? preview.projectName : "A draft from a project"}
          </h1>
        </div>
        <DraftRules />
        {preview && choices ? (
          <section className="rounded-card bg-card p-5 shadow-card sm:p-6">
            <DraftPreviewForm
              projectId={projectId}
              destinationId={destinationId}
              preview={preview}
              categories={choices.categories.map((c) => ({
                id: c.id,
                path: c.path,
              }))}
              shipping={choices.shipping}
              processing={choices.processing}
            />
          </section>
        ) : (
          <p
            className="flex items-start gap-2 rounded-render border border-fail/40 bg-card px-4 py-3 font-sans text-sm text-foreground"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 flex-shrink-0 text-fail" />
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

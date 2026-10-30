"use client";

import {
  Download,
  PackagePlus,
  RefreshCw,
  Scissors,
  Spline,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { enqueueGenerationAction } from "@/app/actions/generation";
import { saveProjectAction } from "@/app/actions/project";
import { vectorizeCardAction } from "@/app/actions/vectorize";
import { AssembledPromptTray } from "@/components/studio/assembled-prompt-tray";
import { CardActions } from "@/components/studio/card-actions";
import { CardFieldRow } from "@/components/studio/card-field-row";
import { RenderCanvas } from "@/components/studio/render-canvas";
import { assemblePrompt, type FieldKey } from "@/domain/cascade";
import { toMicros } from "@/domain/generation-cost";
import type { MasterAsset } from "@/domain/master-asset";
import { isActiveJob } from "@/domain/queue";
import { SEED_BRAND } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";
import { cardEstimate, estimateHint } from "@/lib/card-estimate";
import { assetFilename, downloadAsset } from "@/lib/download";
import { gradientForSeed } from "@/lib/gradient";
import { findRecipe, SEED_RECIPES } from "@/lib/recipes";
import { CostPanel } from "@/modules/laser-pricing/cost-panel";
import { useModule } from "@/modules/modules-context";
import { startCardGeneration } from "@/store/generation-runner";
import { type StudioCard, toPersisted, useProject } from "@/store/project";

const FIELD_ROWS: { key: FieldKey; label: string }[] = [
  { key: "subject", label: "Subject" },
  { key: "materials", label: "Materials" },
  { key: "scene", label: "Scene" },
  { key: "composition", label: "Composition" },
  { key: "lighting", label: "Lighting" },
  { key: "mood", label: "Mood" },
  { key: "palette", label: "Palette" },
];

// `projectMode`: a planned project's card. Generate / Re-roll queue the card
// in the background queue (the same path as the board's batch) instead of
// calling the provider from here; the card shows its job's state, the
// estimated cost of one generation, and no "To video".
export function GenerationCard({
  card,
  master,
  understanding,
  projectMode = false,
}: {
  card: StudioCard;
  master: MasterAsset;
  understanding: BaseUnderstanding;
  projectMode?: boolean;
}) {
  const editCardField = useProject((s) => s.editCardField);
  const toggleCardLock = useProject((s) => s.toggleCardLock);
  const regenerateCard = useProject((s) => s.regenerateCard);
  const promoteToVideo = useProject((s) => s.promoteToVideo);
  const editCardModel = useProject((s) => s.editCardModel);
  const editCardPrompt = useProject((s) => s.editCardPrompt);
  const applyVector = useProject((s) => s.applyVector);
  const job = useProject((s) => s.jobs[card.id]);
  const [open, setOpen] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [vectorError, setVectorError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  // A studio card is queued only when an agent asked for its drawing (the
  // chat's draw); it shows the job like a planned card does.
  const inQueue = isActiveJob(job);

  const recipe = findRecipe(card.recipeId) ?? SEED_RECIPES[0];
  const costModule = useModule("laser-pricing");
  const purpose = recipe.directions.find(
    (s) => s.label === card.direction,
  )?.purpose;
  const assembled = assemblePrompt(
    card,
    master,
    understanding,
    recipe,
    SEED_BRAND,
    card.direction,
  );

  // Generate whenever the card enters "rendering" — on each Generate / re-roll
  // (renderSeed is the explicit trigger). Image cards edit; video cards animate
  // (image-to-video). The request runs outside the component (generation-runner):
  // a remount never re-sends it and an unmount never discards a paid result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeed is the deliberate re-roll trigger; assembled/master are not re-run signals
  useEffect(() => {
    if (projectMode || card.status !== "rendering") return;
    startCardGeneration({
      projectId: useProject.getState().projectId,
      card,
      masterAssetUrl: master.assetUrl,
      prompt: card.promptOverride ?? assembled.prompt,
      negative: assembled.negative,
    });
  }, [card.renderSeed]);

  // Queue this card (planned projects): save pending edits first, so the queue
  // builds the request from what the maker sees, then enqueue. Optimistic
  // "queued" until the next poll.
  async function enqueue() {
    const state = useProject.getState();
    const projectId = state.projectId;
    if (!projectId) return;
    setQueueError(null);
    state.markQueued([card.id]);
    try {
      await saveProjectAction(toPersisted(state), projectId);
      const result = await enqueueGenerationAction({
        projectId,
        cardIds: [card.id],
        // The price shown on the button: the queue refuses if its own is
        // higher (the card changed since).
        ...(estimate ? { shownMaxMicros: toMicros(estimate.max) } : {}),
      });
      if ("error" in result) setQueueError(result.error);
    } catch {
      setQueueError("Could not queue this generation.");
    }
  }

  const takeRoutes = useProject((s) => s.takeRoutes);
  const estimate = cardEstimate(card, takeRoutes);
  const busyLabel =
    job?.status === "queued"
      ? job.attempt >= 1
        ? "Retrying…"
        : "Queued…"
      : job && job.attempt >= 2
        ? "Retrying…"
        : "Generating…";
  const failure =
    job?.status === "failed" && (projectMode || card.status !== "done")
      ? (job.error ?? "failed")
      : null;

  // Vectorize: trace the rendered line-art into a REAL SVG. Only exposed for
  // line-art recipes (tracing a photo produces a bloated, posterized file).
  // centerline = a single path per stroke; outline = region borders (solid
  // shapes).
  async function handleVectorize(mode: "outline" | "centerline") {
    const src = card.outputs[0];
    if (!src) return;
    setVectorizing(true);
    setVectorError(null);
    try {
      const projectId = useProject.getState().projectId;
      const result = await vectorizeCardAction({
        imageUrl: src,
        mode,
        ...(projectId ? { projectId, cardId: card.id } : {}),
      });
      if ("error" in result) setVectorError(result.error);
      else applyVector(card.id, result.url);
    } catch {
      setVectorError("Could not reach the server. Try again.");
    } finally {
      setVectorizing(false);
    }
  }

  return (
    <div className="w-[300px] flex-shrink-0 overflow-hidden rounded-card bg-card shadow-card">
      <div className="p-4 pb-0">
        <RenderCanvas
          seed={card.renderSeed}
          status={inQueue ? "rendering" : card.status}
          type={card.type}
          direction={card.direction}
          outputUrl={card.outputs[0]}
          testId={`card-${card.id}`}
        />
        {purpose ? (
          <p className="px-0.5 pt-2 font-mono text-[0.625rem] leading-snug text-on-surface-mid">
            {purpose}
          </p>
        ) : null}
        <div className="flex items-center gap-2 px-0.5 pt-1.5 pb-0.5">
          <span
            className="size-[18px] flex-shrink-0 rounded-swatch"
            style={{ backgroundImage: gradientForSeed(6) }}
          />
          <span className="font-mono text-[0.625rem] text-on-surface-dim">
            base: master asset
          </span>
        </div>
      </div>

      <div className="px-2.5 py-1">
        {FIELD_ROWS.map(({ key, label }) => (
          <CardFieldRow
            key={key}
            label={label}
            field={card.fields[key]}
            onEdit={(value) => editCardField(card.id, key, value)}
            onToggleLock={() => toggleCardLock(card.id, key)}
            testId={`card-${card.id}-field-${key}`}
          />
        ))}
      </div>

      <AssembledPromptTray
        open={open}
        onToggle={() => setOpen((v) => !v)}
        prompt={assembled.prompt}
        promptOverride={card.promptOverride}
        model={card.model}
        refs={card.references.length}
        onEditModel={(patch) => editCardModel(card.id, patch)}
        onEditPrompt={(value) => editCardPrompt(card.id, value)}
        video={card.type === "video" ? card.video : undefined}
        testId={`card-${card.id}`}
      />

      <CardActions
        type={card.type}
        status={inQueue ? "rendering" : card.status}
        onGenerate={() =>
          projectMode ? void enqueue() : regenerateCard(card.id)
        }
        onReroll={() =>
          projectMode ? void enqueue() : regenerateCard(card.id)
        }
        onPromote={() => promoteToVideo(card.id)}
        busyLabel={inQueue ? busyLabel : undefined}
        generateHint={estimate ? estimateHint(estimate) : "no pinned price"}
        canPromote={!projectMode}
        disabledReason={
          projectMode && card.type === "video"
            ? "The video is made on the board, from an approved scene."
            : undefined
        }
        testId={`card-${card.id}`}
      />
      {queueError || failure ? (
        <p className="px-4 pb-3 font-mono text-[0.625rem] leading-snug text-prov-local">
          {queueError ?? `Last try failed: ${failure}`}
        </p>
      ) : null}

      {recipe.style === "line-art" &&
      card.type === "image" &&
      card.status === "done" ? (
        <>
          <div className="flex border-border-soft border-t">
            {vectorizing ? (
              <span className="flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-medium text-on-surface-dim">
                <RefreshCw className="size-3 animate-spin" /> Vectorizing…
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleVectorize("centerline")}
                  data-testid={`card-${card.id}-centerline`}
                  className="flex flex-1 items-center justify-center gap-1.5 border-border-soft border-r py-3 font-sans text-[0.78rem] font-medium text-on-surface-mid transition-colors hover:bg-secondary"
                >
                  <Scissors className="size-3" /> Centerline
                </button>
                <button
                  type="button"
                  onClick={() => handleVectorize("outline")}
                  data-testid={`card-${card.id}-outline`}
                  className="flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-medium text-on-surface-mid transition-colors hover:bg-secondary"
                >
                  <Spline className="size-3" /> Outline
                </button>
              </>
            )}
          </div>
          {vectorError && !vectorizing ? (
            <p
              className="border-border-soft border-t px-4 py-2.5 font-mono text-[0.625rem] leading-snug text-prov-local"
              role="alert"
            >
              {vectorError}
            </p>
          ) : null}
          {card.vectorUrl && !vectorizing ? (
            <button
              type="button"
              onClick={() => {
                if (card.vectorUrl)
                  void downloadAsset(
                    card.vectorUrl,
                    assetFilename(card.direction, "vector"),
                  );
              }}
              data-testid={`card-${card.id}-download-svg`}
              className="flex w-full items-center justify-center gap-1.5 border-border-soft border-t py-3 font-sans text-[0.78rem] font-semibold text-prov-recipe transition-colors hover:bg-secondary"
            >
              <Download className="size-3" /> Download .svg
            </button>
          ) : null}
          {card.vectorUrl && !vectorizing ? (
            // A design becomes a product: size, material, finish, colours
            // (ROADMAP: a Design SVG "becomes a product").
            <Link
              href={`/projects/new?design=${encodeURIComponent(card.vectorUrl)}`}
              className="flex w-full items-center justify-center gap-1.5 border-border-soft border-t py-3 font-sans text-[0.78rem] font-semibold text-primary transition-colors hover:bg-secondary"
            >
              <PackagePlus className="size-3" /> Make it a product
            </Link>
          ) : null}
          {costModule && card.vectorUrl && !vectorizing ? (
            <CostPanel vectorUrl={card.vectorUrl} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

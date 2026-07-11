"use client";

import { Download, RefreshCw, Scissors, Spline } from "lucide-react";
import { useEffect, useState } from "react";
import { animateVideo } from "@/app/actions/animate";
import { editImage } from "@/app/actions/edit";
import { vectorizeCardAction } from "@/app/actions/vectorize";
import { AssembledPromptTray } from "@/components/studio/assembled-prompt-tray";
import { CardActions } from "@/components/studio/card-actions";
import { CardFieldRow } from "@/components/studio/card-field-row";
import { CostPanel } from "@/components/studio/cost-panel";
import { RenderCanvas } from "@/components/studio/render-canvas";
import { assemblePrompt, type FieldKey } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import { SEED_BRAND } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";
import { assetFilename, downloadAsset } from "@/lib/download";
import { gradientForSeed } from "@/lib/gradient";
import { SEED_RECIPES } from "@/lib/recipes";
import { type StudioCard, useWorkspace } from "@/store/workspace";

const FIELD_ROWS: { key: FieldKey; label: string }[] = [
  { key: "subject", label: "Subject" },
  { key: "materials", label: "Materials" },
  { key: "scene", label: "Scene" },
  { key: "composition", label: "Composition" },
  { key: "lighting", label: "Lighting" },
  { key: "mood", label: "Mood" },
  { key: "palette", label: "Palette" },
];

export function GenerationCard({
  card,
  master,
  understanding,
}: {
  card: StudioCard;
  master: MasterAsset;
  understanding: BaseUnderstanding;
}) {
  const applyCardResult = useWorkspace((s) => s.applyCardResult);
  const markCardError = useWorkspace((s) => s.markCardError);
  const editCardField = useWorkspace((s) => s.editCardField);
  const toggleCardLock = useWorkspace((s) => s.toggleCardLock);
  const switchCardProvider = useWorkspace((s) => s.switchCardProvider);
  const regenerateCard = useWorkspace((s) => s.regenerateCard);
  const promoteToVideo = useWorkspace((s) => s.promoteToVideo);
  const editCardModel = useWorkspace((s) => s.editCardModel);
  const editCardPrompt = useWorkspace((s) => s.editCardPrompt);
  const applyVector = useWorkspace((s) => s.applyVector);
  const [open, setOpen] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);

  const recipe =
    SEED_RECIPES.find((r) => r.id === card.recipeId) ?? SEED_RECIPES[0];
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

  // Generate whenever the card enters "rendering" — on mount and on each re-roll
  // (renderSeed is the explicit trigger). Image cards edit; video cards animate
  // (image-to-video). Both are server actions — the only path into @/providers;
  // the rendering overlay masks the gradient swap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSeed is the deliberate re-roll trigger; assembled/master/setters are not re-run signals
  useEffect(() => {
    if (card.status !== "rendering") return;
    let active = true;
    const prompt = card.promptOverride ?? assembled.prompt;
    const request =
      card.type === "video"
        ? animateVideo({
            startFrameAssetId: card.video?.startFrameAssetId ?? master.assetUrl,
            prompt,
            motion: card.video?.motion ?? "",
            durationSec: card.video?.durationSec ?? 5,
          })
        : editImage({
            masterAssetUrl: master.assetUrl,
            prompt,
            imageInputs: card.references,
            negative: assembled.negative,
            model: card.model,
          });
    request
      .then((result) => {
        if (active) applyCardResult(card.id, result.assets[0]?.url ?? "");
      })
      .catch(() => {
        if (active) markCardError(card.id);
      });
    return () => {
      active = false;
    };
  }, [card.renderSeed]);

  // Vectorize: trace the rendered line-art into a REAL SVG. Only exposed for
  // line-art recipes (tracing a photo produces a bloated, posterized file).
  // centerline = single cut path per stroke (laser cut); outline = region borders
  // (engrave / cut solid shapes).
  async function handleVectorize(mode: "outline" | "centerline") {
    const src = card.outputs[0];
    if (!src) return;
    setVectorizing(true);
    try {
      const { url } = await vectorizeCardAction({ imageUrl: src, mode });
      applyVector(card.id, url);
    } catch {
      // keep the buttons so the user can retry
    } finally {
      setVectorizing(false);
    }
  }

  return (
    <div className="w-[300px] flex-shrink-0 overflow-hidden rounded-card bg-card shadow-card">
      <div className="p-4 pb-0">
        <RenderCanvas
          seed={card.renderSeed}
          status={card.status}
          type={card.type}
          direction={card.direction}
          outputUrl={card.outputs[0]}
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
        onSwitchProvider={
          card.type === "image" ? () => switchCardProvider(card.id) : undefined
        }
        video={card.type === "video" ? card.video : undefined}
      />

      <CardActions
        type={card.type}
        status={card.status}
        onGenerate={() => regenerateCard(card.id)}
        onReroll={() => regenerateCard(card.id)}
        onPromote={() => promoteToVideo(card.id)}
      />

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
                  className="flex flex-1 items-center justify-center gap-1.5 border-border-soft border-r py-3 font-sans text-[0.78rem] font-medium text-on-surface-mid transition-colors hover:bg-secondary"
                >
                  <Scissors className="size-3" /> Centerline
                </button>
                <button
                  type="button"
                  onClick={() => handleVectorize("outline")}
                  className="flex flex-1 items-center justify-center gap-1.5 py-3 font-sans text-[0.78rem] font-medium text-on-surface-mid transition-colors hover:bg-secondary"
                >
                  <Spline className="size-3" /> Outline
                </button>
              </>
            )}
          </div>
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
              className="flex w-full items-center justify-center gap-1.5 border-border-soft border-t py-3 font-sans text-[0.78rem] font-semibold text-prov-recipe transition-colors hover:bg-secondary"
            >
              <Download className="size-3" /> Download .svg
            </button>
          ) : null}
          {card.vectorUrl && !vectorizing ? (
            <CostPanel vectorUrl={card.vectorUrl} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

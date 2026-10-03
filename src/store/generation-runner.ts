"use client";

import { animateVideo } from "@/app/actions/animate";
import { editImage } from "@/app/actions/edit";
import { saveCardOutputAction } from "@/app/actions/project";
import { type StudioCard, useProject } from "@/store/project";

export interface CardGeneration {
  projectId: string | null;
  card: StudioCard;
  masterAssetUrl: string;
  prompt: string;
  negative: string;
}

// In-flight generations, keyed by project + card + render seed. A paid request
// lives here, not in a component: StrictMode's double effect or a remount never
// sends it twice, and an unmount never throws its result away.
const inflight = new Set<string>();

const runKey = ({ projectId, card }: CardGeneration) =>
  `${projectId ?? "unsaved"}:${card.id}:${card.renderSeed}`;

export function startCardGeneration(run: CardGeneration): void {
  const key = runKey(run);
  if (inflight.has(key)) return;
  inflight.add(key);
  const { card } = run;
  const request =
    card.type === "video"
      ? animateVideo({
          startFrameAssetId:
            card.video?.startFrameAssetId ?? run.masterAssetUrl,
          prompt: run.prompt,
          motion: card.video?.motion ?? "",
          durationSec: card.video?.durationSec ?? 8, // 8 s: Etsy needs 5-15 s and Sora snaps 5 → 4 s (2026-09-16)
          model: card.model,
        })
      : editImage({
          masterAssetUrl: run.masterAssetUrl,
          prompt: run.prompt,
          imageInputs: card.references,
          negative: run.negative,
          model: card.model,
        });
  void request
    .then(
      (result) => settle(run, result.assets[0]?.url ?? ""),
      () => fail(run),
    )
    .finally(() => inflight.delete(key));
}

function openCard(run: CardGeneration) {
  const state = useProject.getState();
  const sameProject =
    run.projectId === null || state.projectId === run.projectId;
  return sameProject
    ? state.cards?.find((c) => c.id === run.card.id)
    : undefined;
}

// Apply the result to the open editor when it still shows this card, and always
// persist it to the saved project, so it survives whatever the editor did since.
function settle(run: CardGeneration, url: string) {
  const card = openCard(run);
  if (card && (card.status === "rendering" || card.status === "draft")) {
    useProject.getState().applyCardResult(run.card.id, url);
  }
  if (run.projectId && url) {
    void saveCardOutputAction({
      projectId: run.projectId,
      cardId: run.card.id,
      url,
    }).catch(() => {});
  }
}

function fail(run: CardGeneration) {
  const card = openCard(run);
  if (card?.status === "rendering" && card.renderSeed === run.card.renderSeed) {
    useProject.getState().markCardError(run.card.id);
  }
}

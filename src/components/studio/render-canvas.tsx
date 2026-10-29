"use client";

import { AlertTriangle, Download, Film, Play } from "lucide-react";
import { ZoomableImage } from "@/components/studio/zoomable-image";
import type { Card } from "@/domain/card";
import { isRenderableUrl } from "@/lib/asset-url";
import { assetFilename, downloadAsset } from "@/lib/download";
import { gradientForSeed } from "@/lib/gradient";

// The card's 178px render surface. Shows the real output (image or video, click to
// zoom) once it resolves to a storage URL; otherwise a deterministic gradient
// placeholder, a "generating…" overlay while rendering, and the video affordance.
export function RenderCanvas({
  seed,
  status,
  type,
  direction,
  outputUrl,
  testId,
}: {
  seed: number;
  status: Card["status"];
  type: Card["type"];
  direction: string;
  outputUrl?: string;
  testId: string;
}) {
  const rendering = status === "rendering";
  const failed = status === "error";
  const showOutput = status === "done" && isRenderableUrl(outputUrl);
  return (
    <div
      className="relative h-[178px] overflow-hidden rounded-render shadow-render"
      style={
        showOutput ? undefined : { backgroundImage: gradientForSeed(seed) }
      }
    >
      {showOutput && outputUrl ? (
        <ZoomableImage
          src={outputUrl}
          alt={direction}
          type={type}
          testId={`${testId}-zoom`}
        />
      ) : null}
      {showOutput && outputUrl ? (
        <button
          type="button"
          onClick={() => {
            void downloadAsset(outputUrl, assetFilename(direction, type));
          }}
          aria-label="Download"
          data-testid={`${testId}-download`}
          className="absolute top-2.5 left-2.5 z-10 flex size-7 items-center justify-center rounded-pill bg-card/90 text-foreground shadow-render transition-colors hover:bg-card"
        >
          <Download className="size-3.5" />
        </button>
      ) : null}
      {rendering ? (
        <div className="absolute inset-0 flex animate-pulse items-center justify-center bg-background/60 font-mono text-xs text-foreground">
          generating…
        </div>
      ) : null}
      {type === "video" ? (
        <span className="pointer-events-none absolute top-2.5 right-2.5 flex items-center gap-1 rounded-pill bg-prov-recipe px-2 py-0.5 font-mono text-[0.625rem] text-primary-foreground">
          <Film className="size-2.5" /> Video 8s
        </span>
      ) : null}
      {type === "video" && !rendering && !showOutput && !failed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-pill bg-card/90 shadow-render">
            <Play className="size-[18px] fill-foreground text-foreground" />
          </span>
        </div>
      ) : null}
      {failed ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 px-4 text-center">
          <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] text-prov-local">
            <AlertTriangle className="size-3" /> generation failed
          </span>
          <span className="font-sans text-[0.625rem] text-on-surface-mid">
            Re-roll to retry
          </span>
        </div>
      ) : null}
      <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-pill bg-card/95 px-3 py-1 font-serif text-[0.9375rem] italic text-foreground shadow-[0_2px_8px_rgba(50,32,18,0.18)]">
        {direction}
      </span>
    </div>
  );
}

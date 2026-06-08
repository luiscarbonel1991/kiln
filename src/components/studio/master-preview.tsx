"use client";

import { ImageIcon } from "lucide-react";
import { ZoomableImage } from "@/components/studio/zoomable-image";
import type { MasterAsset } from "@/domain/master-asset";
import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForPrompt } from "@/lib/gradient";

export function MasterPreview({
  master,
  scanning = false,
}: {
  master: MasterAsset;
  scanning?: boolean;
}) {
  // Show the real image (uploaded or generated → object storage), click to zoom;
  // fall back to the prompt gradient for mock/stub URLs.
  const showImage = isRenderableUrl(master.assetUrl);
  return (
    <div className="relative h-[380px] overflow-hidden rounded-render shadow-render">
      {showImage ? (
        <ZoomableImage src={master.assetUrl} alt="Master asset" type="image" />
      ) : (
        <div
          className="size-full"
          style={{
            backgroundImage: gradientForPrompt(master.sourcePrompt ?? ""),
          }}
        />
      )}
      {scanning ? (
        <div className="pointer-events-none absolute inset-x-0 h-0.5 animate-scan bg-card/85 shadow-[0_0_14px_rgba(255,253,249,0.9)]" />
      ) : null}
      <span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-pill bg-card/90 px-2.5 py-1 font-mono text-[0.6875rem] text-foreground">
        <ImageIcon className="size-3" />
        {master.origin === "upload" ? "uploaded" : "generated"} · {master.mime}
      </span>
    </div>
  );
}

"use client";

import { type ReactNode, useState } from "react";
import { isRenderableUrl } from "@/lib/asset-url";
import { cn } from "@/lib/utils";

// A frame that replaces a live listing's photo: the new frame, with the photo
// live now in a corner; a click shows the live photo in its place, another
// brings the new frame back.
export function BeforeAfter({
  before,
  testId,
  children,
}: {
  before: { url: string; aspect: string };
  testId: string;
  children: ReactNode;
}) {
  const [showing, setShowing] = useState<"new" | "live">("new");
  const live = showing === "live";
  if (!isRenderableUrl(before.url)) return <>{children}</>;
  return (
    <div className="relative h-full w-full">
      {live ? (
        <div className="flex h-full w-full items-center justify-center bg-surface-soft">
          {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
          <img
            src={before.url}
            alt="Live on the listing now"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        children
      )}
      <button
        type="button"
        data-testid={testId}
        aria-pressed={live}
        aria-label={live ? "Show the new frame" : "Show the photo live now"}
        onClick={() => setShowing(live ? "new" : "live")}
        className={cn(
          "absolute top-2 right-2 flex flex-col items-center gap-0.5 rounded-field bg-card/90 p-1 shadow-render transition hover:ring-1 hover:ring-primary",
        )}
      >
        {live ? (
          <span className="px-1.5 py-0.5 font-mono text-[0.56rem] text-foreground">
            new frame
          </span>
        ) : (
          <>
            {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
            <img
              src={before.url}
              alt=""
              className="h-10 w-10 rounded-swatch object-cover"
            />
            <span className="font-mono text-[0.56rem] text-on-surface-mid">
              live now
            </span>
          </>
        )}
      </button>
      {live ? (
        <span className="absolute bottom-2 left-2 rounded-pill bg-card/85 px-2 py-0.5 font-mono text-[0.59rem] text-on-surface-mid">
          live now
        </span>
      ) : null}
    </div>
  );
}

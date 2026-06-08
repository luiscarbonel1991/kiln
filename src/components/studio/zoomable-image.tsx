"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { assetFilename, downloadAsset } from "@/lib/download";

// Click-to-zoom image/video. The thumbnail fills its container; clicking opens a
// full-screen lightbox (portaled to body so it escapes card overflow). Esc / the
// backdrop / the X close it. Reusable across the master preview and card renders.
export function ZoomableImage({
  src,
  alt,
  type = "image",
}: {
  src: string;
  alt: string;
  type?: "image" | "video";
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const filename = assetFilename(alt, type);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Zoom ${alt}`}
        className="block size-full cursor-zoom-in"
      >
        {type === "video" ? (
          <video
            src={src}
            className="size-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
          <img src={src} alt={alt} className="size-full object-cover" />
        )}
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close zoom"
                className="absolute inset-0 cursor-zoom-out bg-foreground/85 backdrop-blur-sm"
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 sm:p-12">
                {type === "video" ? (
                  // biome-ignore lint/a11y/useMediaCaption: generated product clip, no caption track
                  <video
                    src={src}
                    className="pointer-events-auto max-h-full max-w-full rounded-render shadow-render"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
                  <img
                    src={src}
                    alt={alt}
                    className="max-h-full max-w-full rounded-render object-contain shadow-render"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  void downloadAsset(src, filename);
                }}
                aria-label="Download"
                className="absolute top-5 right-[68px] flex size-10 items-center justify-center rounded-pill bg-card/90 text-foreground shadow-render transition-colors hover:bg-card"
              >
                <Download className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute top-5 right-5 flex size-10 items-center justify-center rounded-pill bg-card/90 text-foreground shadow-render transition-colors hover:bg-card"
              >
                <X className="size-5" />
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

import { Film } from "lucide-react";
import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForPrompt } from "@/lib/gradient";

const isVideo = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

// What a video slot shows: its clip once rendered; before that, the approved
// scene it will start from, with how it will move; without one, why it waits.
// A mock run's stand-in (an image) shows as an image.
export function VideoArt({
  seed,
  output,
  startFrame,
  caption,
}: {
  seed: string;
  output?: string;
  startFrame: string | null;
  caption: string;
}) {
  if (isRenderableUrl(output)) {
    return isVideo(output) ? (
      // biome-ignore lint/a11y/useMediaCaption: a silent product clip, no speech to caption
      <video
        src={output}
        className="h-full w-full object-cover"
        muted
        loop
        playsInline
        controls
        preload="metadata"
      />
    ) : (
      // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
      <img src={output} alt="" className="h-full w-full object-cover" />
    );
  }
  return (
    <div
      className="relative flex h-full w-full items-center justify-center"
      style={
        isRenderableUrl(startFrame)
          ? undefined
          : { backgroundImage: gradientForPrompt(seed) }
      }
    >
      {isRenderableUrl(startFrame) ? (
        // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
        <img
          src={startFrame}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
      ) : null}
      <span className="relative flex flex-col items-center gap-1 rounded-field bg-card/85 px-3 py-2 text-center font-mono text-[0.6rem] leading-snug text-on-surface-mid">
        <Film className="size-4 text-foreground" />
        {caption}
      </span>
    </div>
  );
}

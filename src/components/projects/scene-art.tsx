import { SceneTextLayer } from "@/components/projects/scene-text-layer";
import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForPrompt } from "@/lib/gradient";

// What a scene slot shows: its candidate image, or a placeholder until one
// exists, with the slot's text layer on top when it has a text template (the
// text is drawn by the template, never by the image model) on a band in the
// maker's brand colours: the same layer Deliver composites onto the file.
// Shared by the board and the New project plan so both read the same.
export function SceneArt({
  seed,
  output,
  text,
  band,
  aspect,
  badge,
}: {
  seed: string;
  output?: string;
  text?: string;
  band: { background: string; ink: string };
  aspect?: string;
  badge?: string;
}) {
  const image = isRenderableUrl(output) ? output : null;
  return (
    <div
      className="relative h-full w-full"
      style={image ? undefined : { backgroundImage: gradientForPrompt(seed) }}
    >
      {image ? (
        // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : null}
      {text ? (
        <div
          className="pointer-events-none absolute inset-0"
          title="Text layer drawn by a template, never by the image model"
          data-testid="scene-text-layer"
        >
          <SceneTextLayer text={text} band={band} aspect={aspect} />
        </div>
      ) : null}
      {badge ? (
        <span className="absolute bottom-3 left-3 rounded-pill bg-card/85 px-2 py-0.5 font-mono text-[0.59rem] text-on-surface-mid">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

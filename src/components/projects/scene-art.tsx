import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForPrompt } from "@/lib/gradient";

// What a scene slot shows: its candidate image, or a placeholder until one
// exists, with the slot's text layer on top when it has a text template (the
// text is drawn by the template, never by the image model). Shared by the
// board and the New project plan so both read the same.
export function SceneArt({
  seed,
  output,
  text,
  badge,
}: {
  seed: string;
  output?: string;
  text?: string;
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
        <span
          className="absolute inset-x-3 top-3 rounded-field bg-card/85 px-2.5 py-1.5 font-serif text-[0.95rem] italic leading-tight text-foreground"
          title="Text layer drawn by a template, never by the image model"
        >
          {text}
        </span>
      ) : null}
      {badge ? (
        <span className="absolute bottom-3 left-3 rounded-pill bg-card/85 px-2 py-0.5 font-mono text-[0.59rem] text-on-surface-mid">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

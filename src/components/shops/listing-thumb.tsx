import { ImageOff } from "lucide-react";

// A listing's first photo at list size, framed like a thumb; a quiet tile
// when Etsy gave none.
export function ListingThumb({
  src,
  size = 56,
}: {
  src: string | null;
  size?: number;
}) {
  return (
    <span
      className="relative block flex-shrink-0 overflow-hidden rounded-thumb bg-surface-soft shadow-[0_4px_12px_-4px_rgba(50,32,18,0.22)]"
      style={{ width: size, height: size }}
    >
      {src ? (
        // biome-ignore lint/performance/noImgElement: Etsy's own image address, shown as Etsy serves it
        <img
          src={src}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-on-surface-dim">
          <ImageOff className="size-4" />
        </span>
      )}
    </span>
  );
}

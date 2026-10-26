import { isRenderableUrl } from "@/lib/asset-url";

// The maker's own photo in its frame: the frame takes the photo's proportions,
// so nothing is cropped.
export function PhotoArt({ url, alt }: { url: string; alt: string }) {
  return isRenderableUrl(url) ? (
    // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
    <img src={url} alt={alt} className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center font-mono text-[0.625rem] text-on-surface-dim">
      photo not found
    </div>
  );
}

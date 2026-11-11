import type { CSSProperties } from "react";
import type { KitTake } from "@/lib/site-kit";

const SIZE: Record<KitTake["aspect"], [number, number]> = {
  "1:1": [1440, 1440],
  "4:5": [1200, 1500],
};

// A take Kiln made for the sample, served as a fixed file.
export function Take({
  take,
  className,
  eager,
  alt,
  style,
}: {
  take: KitTake;
  className?: string;
  eager?: boolean;
  alt?: string;
  style?: CSSProperties;
}) {
  const [width, height] = SIZE[take.aspect];
  return (
    // biome-ignore lint/performance/noImgElement: a take Kiln made, served as a fixed file
    <img
      src={take.url}
      alt={alt ?? take.alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      className={className}
      style={style}
    />
  );
}

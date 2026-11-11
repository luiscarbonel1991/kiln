"use client";

import { useEffect, useRef } from "react";

// The kit's video. It plays, muted and looping, only while it is on screen
// and only when the visitor has not asked for reduced motion; otherwise it
// waits on its poster with its controls.
export function KitVideo({
  src,
  poster,
  label,
}: {
  src: string;
  poster: string;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.5 },
    );
    seen.observe(video);
    return () => seen.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      aria-label={label}
      width={720}
      height={1280}
      muted
      loop
      playsInline
      controls
      preload="none"
    />
  );
}

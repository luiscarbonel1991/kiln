import type { StoryScene } from "@/lib/home-story";

// What each sample take shows, said for someone who cannot see it.
const ALT: Record<string, string> = {
  "/home/sample/hero.jpg":
    "The maple cutting board standing on a plain backdrop, engraved The Riveras, 2026",
  "/home/sample/in-use.jpg":
    "The cutting board leaning on a dark stone kitchen counter beside a bowl of peppers",
  "/home/sample/lifestyle.jpg":
    "The cutting board on a set dinner table with bread, cheese, grapes and a glass of wine",
  "/home/sample/detail.jpg":
    "A close view of the board's engraved lettering on a dark wood table",
};

const SIZE: Record<string, [number, number]> = {
  "1:1": [1080, 1080],
  "4:5": [864, 1080],
};

export const takeAlt = (scene: StoryScene) =>
  ALT[scene.url] ?? `${scene.label} of the sample cutting board`;

// A take Kiln made for the sample, at its own pixel size.
export function Take({
  scene,
  className,
  eager,
  alt,
}: {
  scene: StoryScene;
  className?: string;
  eager?: boolean;
  alt?: string;
}) {
  const [width, height] = SIZE[scene.aspect] ?? [1080, 1080];
  return (
    // biome-ignore lint/performance/noImgElement: a take Kiln made, served as a fixed file
    <img
      src={scene.url}
      alt={alt ?? takeAlt(scene)}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      className={className}
    />
  );
}

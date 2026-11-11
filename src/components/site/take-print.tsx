import type { CSSProperties } from "react";
import { Print } from "@/components/site/print";
import { Take } from "@/components/site/take";
import { WaxCross, WaxRing, WaxTick } from "@/components/site/wax";
import type { StoryScene } from "@/lib/home-story";

// A take as a print, marked by hand with its check: a tick when it passed; a
// cross, and a ring around the wording Kiln read, when it failed.

const reason = (scene: StoryScene) =>
  scene.check?.label.replace(/^check failed · /, "") ?? "";
const failedCheck = (scene: StoryScene) => scene.check?.status === "failed";

// Where each take's first line of wording sits (x, y, w, h as fractions).
const NAME_AT: Record<string, number[]> = {
  "/home/sample/hero.jpg": [0.2, 0.36, 0.66, 0.18],
  "/home/sample/in-use.jpg": [0.22, 0.43, 0.56, 0.13],
  "/home/sample/lifestyle.jpg": [0.25, 0.42, 0.52, 0.13],
  "/home/sample/detail.jpg": [0.1, 0.32, 0.84, 0.2],
};

const box = ([x, y, w, h]: number[]): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
});

export function TakePrint({
  scene,
  tilt,
  className,
  eager,
  at,
  short,
}: {
  scene: StoryScene;
  tilt: number;
  className?: string;
  eager?: boolean;
  // When the marks are drawn: a delay in ms after load, or as it scrolls in.
  at: number | "seen";
  short?: boolean;
}) {
  const failed = failedCheck(scene);
  const when = at === "seen" ? "wax-seen" : "wax-now";
  const delay =
    at === "seen" ? undefined : ({ "--wax-at": at } as CSSProperties);
  const where = NAME_AT[scene.url];
  return (
    <Print
      tilt={tilt}
      className={className}
      tone={failed ? "failed" : "free"}
      title={scene.label}
      note={
        failed
          ? short
            ? "Failed its check: letters too thin"
            : `Failed: ${reason(scene)}`
          : "Checked · text 2/2 · letters match"
      }
      marks={
        failed ? (
          <WaxCross className={`wax-fail wax-corner ${when}`} />
        ) : (
          <WaxTick className={`wax-corner ${when}`} />
        )
      }
    >
      <Take scene={scene} eager={eager} />
      {failed && where ? (
        <WaxRing
          className={`wax-fail ${when}`}
          style={{ ...box(where), ...delay, rotate: "-3deg" }}
        />
      ) : null}
    </Print>
  );
}

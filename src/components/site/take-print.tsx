import type { CSSProperties } from "react";
import { Print } from "@/components/site/print";
import { Take } from "@/components/site/take";
import { WaxCross, WaxRing, WaxTick } from "@/components/site/wax";
import type { KitTake } from "@/lib/site-kit";

// A take as a print, marked by hand with its check: a tick when it passed; a
// cross, and a ring around the wording Kiln read, when it failed.

const box = ([x, y, w, h]: number[]): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
});

export function TakePrint({
  take,
  tilt = 0,
  className,
  eager,
  at = "seen",
  title,
  note,
}: {
  take: KitTake;
  tilt?: number;
  className?: string;
  eager?: boolean;
  // When the marks are drawn: a delay in ms after load, or as it scrolls in.
  at?: number | "seen";
  title?: string;
  note?: string;
}) {
  const when = at === "seen" ? "wax-seen" : "wax-now";
  const delay =
    at === "seen" ? undefined : ({ "--wax-at": at } as CSSProperties);
  return (
    <Print
      tilt={tilt}
      className={className}
      tone={take.passed ? "free" : "failed"}
      title={title ?? take.label}
      note={note ?? (take.passed ? take.check : "Failed its check")}
      marks={
        take.passed ? (
          <WaxTick className={`wax-corner ${when}`} style={delay} />
        ) : (
          <WaxCross className={`wax-fail wax-corner ${when}`} style={delay} />
        )
      }
    >
      <Take take={take} eager={eager} />
      {!take.passed && take.read ? (
        <WaxRing
          className={`wax-fail ${when}`}
          style={{ ...box(take.read), ...delay }}
        />
      ) : null}
    </Print>
  );
}

import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { Print } from "@/components/site/print";
import { Take } from "@/components/site/take";
import type { SiteKit } from "@/lib/site-kit";

// Refreshing a listing that already sells, as the app plans it: each photo
// stays as it is or is replaced in its place by a frame of the kit, and only
// the replacements are made and priced. The listing's own photos are the
// maker's, so the page never pretends to show them: each is the back of a
// print. The replacements and their costs are the sample kit's.

type Made = {
  frame: string;
  short: string;
  cost: string;
  free: boolean;
  art: "hero" | "lifestyle" | "size";
};
type Slot = { kind: "keep" } | ({ kind: "replace" } & Made);

const ROW: Slot[] = [
  {
    kind: "replace",
    frame: "Marketplace hero",
    short: "the hero",
    cost: "$0.12",
    free: false,
    art: "hero",
  },
  { kind: "keep" },
  {
    kind: "replace",
    frame: "Size & spec",
    short: "size & spec",
    cost: "free",
    free: true,
    art: "size",
  },
  { kind: "keep" },
  {
    kind: "replace",
    frame: "Lifestyle scene",
    short: "a lifestyle scene",
    cost: "$0.09",
    free: false,
    art: "lifestyle",
  },
  { kind: "keep" },
];

const TOTAL = "$0.21";
const MADE = ROW.filter(
  (s): s is { kind: "replace" } & Made => s.kind === "replace",
);
const KEPT = ROW.length - MADE.length;

function Art({ kit, art }: { kit: SiteKit; art: Made["art"] }) {
  if (art === "size") {
    const size = kit.frames.find((f) => f.label === "Size & spec");
    return size ? (
      <ExactSlotArt view={size.view} aspect="1:1" plate={kit.plate} />
    ) : null;
  }
  return <Take take={art === "hero" ? kit.takes.hero : kit.takes.lifestyle} />;
}

export function SiteRefresh({ kit }: { kit: SiteKit }) {
  return (
    <section className="kl-band kl-refresh" aria-labelledby="refresh-title">
      <div className="kl-head">
        <h2 id="refresh-title">
          Already selling it? Replace only what needs it.
        </h2>
        <p>
          Most work is not a new listing. Bring the photos your listing shows
          today, mark which stay and which go, and Kiln makes each replacement
          in its place, from the product. What stays is delivered as it is; only
          what is replaced is priced.
        </p>
      </div>
      <div className="kl-plan">
        <div className="kl-knobs kl-plan-panel" aria-hidden>
          <p className="kl-knobs-head">Your listing · {ROW.length} photos</p>
          <ul>
            {ROW.map((s, n) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sample row
                key={n}
                data-go={s.kind === "replace"}
                data-paid={s.kind === "replace" && !s.free}
              >
                <i className="kl-yours">
                  <b>Your photo</b>
                </i>
                <span className="kl-switch">
                  <em data-on={s.kind === "keep"}>Keep</em>
                  <em data-on={s.kind === "replace"}>Replace</em>
                </span>
                <span className="kl-with">
                  {s.kind === "replace" ? `with ${s.short}` : "as it is"}
                </span>
                <b>{s.kind === "replace" ? s.cost : "free"}</b>
              </li>
            ))}
          </ul>
          <p className="kl-knobs-foot">
            <span>
              {KEPT} kept · {MADE.length} made
            </span>
            <b>Generate · ≈ {TOTAL}</b>
          </p>
        </div>
        <p className="sr-only">
          The plan for a listing with {ROW.length} photos: {KEPT} kept as they
          are, and {MADE.length} replaced by a marketplace hero, a size and spec
          frame drawn for free and a lifestyle scene, for about {TOTAL} in all.
        </p>
        <div className="kl-plan-made">
          {MADE.map((s, i) => (
            <Print
              key={s.frame}
              tilt={[-3, 2, -1][i] ?? 0}
              className={`kl-made-${s.art}`}
              tone={s.free ? "free" : "paid"}
              title={s.frame}
              note={
                s.free ? "Drawn from the spec · free" : `Checked · ${s.cost}`
              }
            >
              <Art kit={kit} art={s.art} />
            </Print>
          ))}
        </div>
      </div>
    </section>
  );
}

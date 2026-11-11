import type { CSSProperties } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { KitVideo } from "@/components/site/kit-video";
import { Print } from "@/components/site/print";
import { TakePrint } from "@/components/site/take-print";
import type { SiteKit } from "@/lib/site-kit";

// What Kiln makes for one product, as six moments: the free frames, the
// scenes and their controls, the check, the colours, the video and the
// listing text. Each shows the real output large, with what it cost.

const money = (n: number) => `$${n.toFixed(2)}`;

// A scene's controls as the board offers them, with the choice this scene
// ran on. A drawing of the panel, not the panel.
const KNOBS: { name: string; options: string[]; chosen: number }[] = [
  {
    name: "Camera",
    options: ["Eye level", "A little above", "From above"],
    chosen: 1,
  },
  { name: "Distance", options: ["Close", "Medium", "Wide"], chosen: 1 },
  { name: "Light", options: ["Window", "Studio", "Warm"], chosen: 0 },
  { name: "Shadow", options: ["Faint", "Soft", "Strong"], chosen: 1 },
];

const REASONS = [
  "Too small",
  "Too busy",
  "Too dark",
  "Shadows too strong",
  "Can't see its top",
];

function Loupe({
  src,
  alt,
  value,
  note,
  tone,
}: {
  src: string;
  alt: string;
  value: string;
  note: string;
  tone?: "pass" | "fail";
}) {
  return (
    <li data-tone={tone}>
      <div className="kl-lens">
        {/* biome-ignore lint/performance/noImgElement: a fixed crop of a take Kiln made */}
        <img src={src} alt={alt} width={640} height={640} loading="lazy" />
      </div>
      <p>
        <b>{value}</b>
        {note}
      </p>
    </li>
  );
}

// How much of one of the shop's limits the draft uses: a bar for a count of
// characters, one box per item when the limit is a handful of things.
function Measure({
  label,
  used,
  max,
  unit,
  slots,
}: {
  label: string;
  used: number;
  max: number;
  unit: string;
  slots?: boolean;
}) {
  return (
    <div className="kl-measure">
      <p>
        <b>{label}</b>
        {used} of {max} {unit}
      </p>
      {slots ? (
        <div className="kl-slots" aria-hidden>
          {Array.from({ length: max }, (_, n) => (
            <i
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed boxes, never reordered
              key={n}
              data-on={n < used}
              style={{ "--at": n } as CSSProperties}
            />
          ))}
        </div>
      ) : (
        <div className="kl-ruler" aria-hidden>
          <i style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
        </div>
      )}
      <span>Within the limit · {max - used} to spare</span>
    </div>
  );
}

export function SiteMade({ kit }: { kit: SiteKit }) {
  const p = kit.product;
  const words = kit.words;
  const tilts = [-1.4, 0.9, -0.6, 1.2];
  return (
    <div id="kit" className="kl-made">
      <section className="kl-band" aria-labelledby="frames-title">
        <div className="kl-head">
          <h2 id="frames-title">Four frames, drawn from your numbers. Free.</h2>
          <p>
            {p.size}, {p.material}, {p.colours.length} colours, a family name, $
            {p.price}. Kiln draws these the moment the product is saved, at
            every size your shop asks for. They cost nothing, and they cannot
            get your product wrong.
          </p>
        </div>
        <ul className="kl-frames">
          {kit.frames.map((f, n) => (
            <li key={f.label}>
              <Print tilt={tilts[n] ?? 0} tone="free" title={f.label}>
                <ExactSlotArt view={f.view} aspect="1:1" plate={kit.plate} />
              </Print>
            </li>
          ))}
        </ul>
      </section>

      <section className="kl-band" aria-labelledby="scenes-title">
        <div className="kl-head">
          <h2 id="scenes-title">
            Scenes set around your real product. No prompt to write.
          </h2>
          <p>
            An image model stages the product where it lives. You steer with
            controls, not prose, and every scene shows its price before it runs.
          </p>
        </div>
        <div className="kl-scenes">
          <div className="kl-knobs" aria-hidden>
            <p className="kl-knobs-head">Lifestyle scene</p>
            {KNOBS.map((k) => (
              <div key={k.name} className="kl-knob">
                <span>{k.name}</span>
                <ul>
                  {k.options.map((o, n) => (
                    <li key={o} data-on={n === k.chosen}>
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="kl-knobs-foot">
              <span>GPT Image 2 · 2K</span>
              <b>Generate · ≈ $0.08</b>
            </p>
          </div>
          <p className="sr-only">
            A scene's controls: camera, distance, light and shadow, each with
            three choices, and a Generate button that shows the price, about
            $0.08.
          </p>
          <TakePrint
            take={kit.takes.lifestyle}
            tilt={-1.2}
            className="kl-scene-a"
          />
          <TakePrint take={kit.takes.gift} tilt={1.6} className="kl-scene-b" />
        </div>
      </section>

      <section className="kl-band kl-check" aria-labelledby="check-title">
        <div className="kl-head">
          <h2 id="check-title">Every photo is checked against your product.</h2>
          <p>
            Kiln reads the words on each take and weighs its letters against the
            spec. This photo looked right and was not: its letters came out
            thinner. It is marked, never hidden, and nothing is re-rolled behind
            your back. You decide what happens next.
          </p>
        </div>
        <div className="kl-check-body">
          <TakePrint
            take={kit.takes.failed}
            tilt={-1.5}
            className="kl-check-print"
            note={`Failed: ${kit.takes.failed.check}`}
          />
          <div className="kl-check-side">
            <ul className="kl-lenses">
              <Loupe
                src={kit.loupes.reference}
                alt="The letter K as the spec draws it"
                value="0.15"
                note="The spec: a stroke is 0.15 of the letter's height."
              />
              <Loupe
                src={kit.loupes.passed}
                alt="The letter K on a take that passed, enlarged"
                value="Match"
                note="A take that passed."
                tone="pass"
              />
              <Loupe
                src={kit.loupes.failed}
                alt="The letter K on the take that failed, enlarged"
                value="0.09"
                note="This take: too thin."
                tone="fail"
              />
            </ul>
            <div className="kl-reasons">
              <p>
                <b>Not what you wanted?</b> Say why, and the reason moves a
                control for the next take. Nobody rewrites a prompt.
              </p>
              <ul aria-label="Reasons to reject a take">
                {REASONS.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="kl-band" aria-labelledby="colours-title">
        <div className="kl-head">
          <h2 id="colours-title">
            {kit.colours.length} glazes, {kit.colours.length} heroes.
          </h2>
          <p>
            The drawn frames follow every colour for free. A photo in another
            colour is a new take from the same drawing, priced first and checked
            after. Each of these cost $0.12.
          </p>
        </div>
        <ul className="kl-colours">
          {kit.colours.map((c, n) => (
            <li key={c.key}>
              <TakePrint
                take={c.take}
                tilt={[-1.6, 1.1, -0.8, 1.5][n] ?? 0}
                title={c.name}
                note="Checked · letters match"
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="kl-band kl-moves" aria-labelledby="video-title">
        <div className="kl-moves-copy">
          <h2 id="video-title">Then it moves.</h2>
          <p>
            A video model animates a scene you approved, 3 to 10 seconds, the
            product exactly as photographed. This one is {kit.video.seconds}{" "}
            seconds and cost {money(kit.video.cost)}.
          </p>
          <p>
            Or let Kiln cut a clip from your approved photos. That one is free.
          </p>
        </div>
        <Print
          tilt={1.2}
          className="kl-video"
          title="Listing video"
          note={`${kit.video.seconds} s · from the lifestyle scene`}
        >
          <KitVideo
            src={kit.video.url}
            poster={kit.video.poster}
            label="The coaster beside a glass of wine as the camera moves slowly closer"
          />
        </Print>
      </section>

      {words ? (
        <section className="kl-band" aria-labelledby="words-title">
          <div className="kl-head">
            <h2 id="words-title">The listing, written and counted.</h2>
            <p>
              Title, description, tags, variations and personalization fields
              are drafted from the spec and held to {words.channel}'s limits
              before you read them. A text model rewrites them when you ask, for
              about $0.03.
            </p>
          </div>
          <div className="kl-words">
            <div className="kl-slip kl-listing">
              <b>{words.title}</b>
              <p>{words.description}</p>
              <ul>
                {words.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="kl-measures">
              <p className="kl-measures-head">
                Counted against {words.channel}'s limits
              </p>
              <Measure
                label="Title"
                used={words.title.length}
                max={words.titleMax}
                unit="characters"
              />
              <Measure
                label="Tags"
                used={words.tags.length}
                max={words.tagMax}
                unit="tags"
                slots
              />
              <p className="kl-free">Drafted from the spec, free.</p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

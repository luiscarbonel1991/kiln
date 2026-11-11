import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { BoardFace } from "@/components/site/board-face";
import { Take } from "@/components/site/take";
import type { HomeStory, StoryScene } from "@/lib/home-story";
import { GET_STARTED } from "@/lib/site";

// Direction B, "the inspection": the page opens on the check itself. A take
// that passed and the take that failed sit side by side with what Kiln read
// on each, then the letters are put under a loupe next to the reference.

const reason = (scene: StoryScene) =>
  scene.check?.label.replace(/^check failed · /, "") ?? "";

// Where each take's wording sits, as fractions of the image (x, y, w, h) and
// the tilt of the line.
const READ: Record<string, { box: number[]; tilt: number }[]> = {
  "/home/sample/hero.jpg": [
    { box: [0.235, 0.385, 0.59, 0.13], tilt: 0.6 },
    { box: [0.43, 0.585, 0.215, 0.085], tilt: 0.6 },
  ],
  "/home/sample/detail.jpg": [
    { box: [0.135, 0.345, 0.775, 0.14], tilt: -3.2 },
    { box: [0.405, 0.535, 0.285, 0.105], tilt: -3.2 },
  ],
};

const place = ([x, y, w, h]: number[], tilt: number): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
  rotate: `${tilt}deg`,
});

function Inspected({
  scene,
  eager,
  children,
}: {
  scene: StoryScene;
  eager?: boolean;
  children: ReactNode;
}) {
  const ok = scene.check?.status !== "failed";
  return (
    <figure className="lb-inspected" data-ok={ok}>
      <div className="lb-photo">
        <Take scene={scene} eager={eager} className="lb-fill" />
        {(READ[scene.url] ?? []).map((r, n) => (
          <span
            key={r.box.join()}
            className="lb-read"
            style={{ ...place(r.box, r.tilt), "--n": n } as CSSProperties}
            aria-hidden
          />
        ))}
      </div>
      <figcaption>{children}</figcaption>
    </figure>
  );
}

// A round crop of an image, enlarged around one point: `at` is the point as
// fractions of the image, `zoom` how many loupe widths the image spans, and
// `ratio` the image's height over its width.
function loupe(at: [number, number], zoom: number, ratio: number) {
  return {
    width: `${zoom * 100}%`,
    left: `${50 - at[0] * zoom * 100}%`,
    top: `${50 - at[1] * zoom * ratio * 100}%`,
  } satisfies CSSProperties;
}

export function DirectionB({ story }: { story: HomeStory }) {
  const p = story.product;
  const passed = story.scenes[0];
  const failed = story.scenes.find((s) => s.check?.status === "failed");
  const maple = p.colours[0];
  const name = p.wording[0]?.example ?? "";
  const year = p.wording[1]?.example;
  const words = story.words;
  const face = { face: maple?.face ?? "#E8D2A6", ink: "#3B2A1E", name, year };
  return (
    <div className="lb">
      <header className="lb-top">
        <Link href="/welcome" className="lb-mark">
          Kiln
        </Link>
        <Link href={GET_STARTED.href} className="lb-cta lb-cta-small">
          {GET_STARTED.label}
        </Link>
      </header>

      <main>
        <section className="lb-hero">
          <div className="lb-copy">
            <h1>Photos of your product, checked letter by letter.</h1>
            <p>
              Kiln stages your real product in the scenes a listing needs,
              writes the listing, and compares every photo with the product
              before you see it. What fails is shown as failed.
            </p>
            <div className="lb-actions">
              <Link href={GET_STARTED.href} className="lb-cta">
                {GET_STARTED.label}
              </Link>
              <span>Each paid step shows its price first.</span>
            </div>
          </div>

          <div className="lb-pair">
            {passed ? (
              <Inspected scene={passed} eager>
                <b>Passed</b>
                Both lines read, letters match the product. This one went to the
                listing.
              </Inspected>
            ) : null}
            {failed ? (
              <Inspected scene={failed}>
                <b>Failed</b>
                {reason(failed)}. Shown to the maker as failed.
              </Inspected>
            ) : null}
          </div>
        </section>

        <section className="lb-table">
          <div className="lb-head">
            <h2>Everything Kiln made for one cutting board.</h2>
            <p>
              Three frames drawn from the spec, which cost nothing and cannot be
              wrong. Four scenes from an image model, each priced before it ran
              and checked after.
            </p>
          </div>
          <ul className="lb-strip">
            {story.exact.map((f) => (
              <li key={f.label} data-kind="exact">
                <div className="lb-tile">
                  <ExactSlotArt view={f.view} aspect={f.aspect} />
                </div>
                <p>
                  <b>{f.label}</b>
                  Drawn from the spec · free
                </p>
              </li>
            ))}
            {story.scenes.map((s) => {
              const ok = s.check?.status !== "failed";
              return (
                <li key={s.url} data-kind="scene" data-ok={ok}>
                  <div className="lb-tile">
                    <Take scene={s} className="lb-fill" />
                  </div>
                  <p>
                    <b>{s.label}</b>
                    {ok ? "Checked · letters match" : "Failed its check"}
                  </p>
                </li>
              );
            })}
          </ul>
          {words ? (
            <p className="lb-words">
              <span>The words are counted too.</span> Title{" "}
              <b>
                {words.title.length} of {words.titleMax}
              </b>{" "}
              characters, tags{" "}
              <b>
                {words.tags.length} of {words.tagMax}
              </b>
              , against {words.channel}'s limits.
            </p>
          ) : null}
        </section>

        {failed && passed ? (
          <section className="lb-loupes">
            <div className="lb-head">
              <h2>Why the fourth photo failed.</h2>
              <p>
                It looks fine at a glance. Kiln measures: on the product, a
                letter's stroke is 0.17 of its height. On this take it came out
                at 0.08. Close is not the product, so the take is marked and you
                decide.
              </p>
            </div>
            <ul className="lb-lenses">
              <li>
                <div className="lb-lens">
                  <BoardFace
                    {...face}
                    className="lb-lens-art"
                    style={loupe([0.45, 0.42], 6.4, 0.625)}
                    label={`The reference drawing's letter R, from ${name}`}
                  />
                </div>
                <p>
                  <b>0.17</b>
                  The reference: the board's face, drawn from the spec.
                </p>
              </li>
              <li data-ok="true">
                <div className="lb-lens">
                  <Take
                    scene={passed}
                    className="lb-lens-art"
                    style={loupe([0.508, 0.45], 5.6, 1)}
                    alt="The letter R on the take that passed, enlarged"
                  />
                </div>
                <p>
                  <b>Match</b>
                  The take that passed: the stroke holds its weight.
                </p>
              </li>
              <li data-ok="false">
                <div className="lb-lens">
                  <Take
                    scene={failed}
                    className="lb-lens-art"
                    style={loupe([0.468, 0.405], 4.4, 1.25)}
                    alt="The letter R on the take that failed, enlarged"
                  />
                </div>
                <p>
                  <b>0.08</b>
                  The take that failed: what Kiln read on its letters.
                </p>
              </li>
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}

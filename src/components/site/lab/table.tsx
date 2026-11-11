import Link from "next/link";
import type { CSSProperties } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { BoardFace } from "@/components/site/board-face";
import { Print } from "@/components/site/print";
import { Take } from "@/components/site/take";
import { TakePrint } from "@/components/site/take-print";
import { WaxDefs } from "@/components/site/wax";
import type { HomeStory, StoryScene } from "@/lib/home-story";
import { GET_STARTED } from "@/lib/site";

// Direction "the table": one product's kit as prints on a dark table, marked
// by hand the way a photographer marks proofs. A tick on the takes that
// passed their check; a ring and a cross on the one that failed.

const failedCheck = (scene: StoryScene) => scene.check?.status === "failed";

function loupe(at: [number, number], zoom: number, ratio: number) {
  return {
    width: `${zoom * 100}%`,
    left: `${50 - at[0] * zoom * 100}%`,
    top: `${50 - at[1] * zoom * ratio * 100}%`,
  } satisfies CSSProperties;
}

export function Table({ story }: { story: HomeStory }) {
  const p = story.product;
  const [hero, inUse, lifestyle] = story.scenes;
  const failed = story.scenes.find(failedCheck);
  const words = story.words;
  const name = p.wording[0]?.example ?? "";
  const colours = story.exact[0];
  return (
    <div className="tb">
      <WaxDefs />
      <header className="tb-top">
        <Link href="/welcome" className="tb-mark">
          Kiln
        </Link>
        <Link href={GET_STARTED.href} className="tb-cta tb-cta-small">
          {GET_STARTED.label}
        </Link>
      </header>

      <main>
        <section className="tb-hero">
          <div className="tb-copy">
            <h1>Your product, photographed, listed and checked.</h1>
            <p>
              Describe what you make once. Kiln draws the exact frames, stages
              your real product in the scenes a listing needs, writes the text
              to each shop's limits, and checks every photo before you see it.
            </p>
            <div className="tb-actions">
              <Link href={GET_STARTED.href} className="tb-cta">
                {GET_STARTED.label}
              </Link>
              <span>Nothing is paid without your ok.</span>
            </div>
            <p className="tb-aside">
              On the table: what Kiln made for one sample cutting board. Three
              photos passed. One did not, and says so.
            </p>
          </div>

          <div className="tb-pile">
            {lifestyle ? (
              <TakePrint
                scene={lifestyle}
                tilt={2.5}
                className="tb-p2"
                eager
                at={1300}
              />
            ) : null}
            {hero ? (
              <TakePrint
                scene={hero}
                tilt={-3}
                className="tb-p1"
                eager
                at={900}
              />
            ) : null}
            {colours ? (
              <Print
                tilt={3.5}
                className="tb-p4"
                tone="free"
                title={colours.label}
                note="Drawn from the spec · free"
              >
                <ExactSlotArt view={colours.view} aspect={colours.aspect} />
              </Print>
            ) : null}
            {words ? (
              <div className="tb-slip tb-p5">
                <b>{words.title}</b>
                <span>
                  Title · {words.title.length} of {words.titleMax} characters
                </span>
              </div>
            ) : null}
            {failed ? (
              <TakePrint
                scene={failed}
                tilt={-2}
                className="tb-p3"
                eager
                at={1700}
                short
              />
            ) : null}
          </div>
        </section>

        <section className="tb-kit">
          <div className="tb-head">
            <h2>One product went in. All of this came out.</h2>
            <p>
              {p.size}, {p.material}, {p.finish.toLowerCase()},{" "}
              {p.colours.length} colours, a family name, ${p.price}. That is
              everything the maker typed.
            </p>
          </div>

          <div className="tb-row">
            <p className="tb-row-note">
              <b>Four scenes</b> from an image model, each priced before it ran
              and checked after.
            </p>
            <ul className="tb-prints">
              {story.scenes.map((s, n) => (
                <li key={s.url}>
                  <TakePrint
                    scene={s}
                    tilt={[-1.2, 0.8, -0.6, 1.4][n] ?? 0}
                    at="seen"
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="tb-row">
            <p className="tb-row-note">
              <b>Three frames and the listing text</b> drawn from the spec. They
              cost nothing and cannot be wrong.
            </p>
            <ul className="tb-prints">
              {story.exact.map((f, n) => (
                <li key={f.label}>
                  <Print
                    tilt={[0.9, -1.1, 0.5][n] ?? 0}
                    tone="free"
                    title={f.label}
                    note="Drawn from the spec · free"
                  >
                    <ExactSlotArt view={f.view} aspect={f.aspect} />
                  </Print>
                </li>
              ))}
              {words ? (
                <li>
                  <div className="tb-slip tb-listing">
                    <b>{words.title}</b>
                    <p>{words.description}</p>
                    <ul>
                      {words.tags.slice(0, 6).map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <span>
                      Title {words.title.length} of {words.titleMax} · tags{" "}
                      {words.tags.length} of {words.tagMax} · {words.channel}'s
                      limits
                    </span>
                  </div>
                </li>
              ) : null}
            </ul>
          </div>
        </section>

        {failed && hero ? (
          <section className="tb-loupes">
            <div className="tb-head">
              <h2>Why the fourth photo failed.</h2>
              <p>
                It looks fine at a glance. Kiln measures: on the product, a
                letter's stroke is 0.17 of its height. On this take it read
                0.08. Close is not the product, so the take is marked and you
                decide.
              </p>
            </div>
            <ul className="tb-lenses">
              <li>
                <div className="tb-lens">
                  <BoardFace
                    face={p.colours[0]?.face ?? "#E8D2A6"}
                    ink="#3B2A1E"
                    name={name}
                    year={p.wording[1]?.example}
                    className="tb-lens-art"
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
                <div className="tb-lens">
                  <Take
                    scene={hero}
                    className="tb-lens-art"
                    style={loupe([0.508, 0.45], 5.6, 1)}
                    alt="The letter R on a take that passed, enlarged"
                  />
                </div>
                <p>
                  <b>Match</b>A take that passed: the stroke holds its weight.
                </p>
              </li>
              <li data-ok="false">
                <div className="tb-lens">
                  <Take
                    scene={failed}
                    className="tb-lens-art"
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

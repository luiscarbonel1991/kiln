import Link from "next/link";
import { type BenchColour, SpecBench } from "@/components/site/lab/spec-bench";
import { Take } from "@/components/site/take";
import type { HomeStory, StoryScene } from "@/lib/home-story";
import { GET_STARTED } from "@/lib/site";

// Direction C, "describe it once": the page opens on the spec itself, as a
// drawing a visitor can edit. The frames redraw as they type; the photos do
// not, and the page says why. Then the takes with their checks, and the
// listing text measured against its limits.

const reason = (scene: StoryScene) =>
  scene.check?.label.replace(/^check failed · /, "") ?? "";

function swatches(story: HomeStory): BenchColour[] {
  for (const f of story.exact) {
    if (f.view.kind === "colour-grid") {
      return f.view.swatches.map((s) => ({
        key: s.key,
        name: s.name,
        face: s.face,
        inlay: s.inlay ?? "#3B2A1E",
      }));
    }
  }
  return [];
}

function Measure({
  label,
  used,
  max,
  unit,
}: {
  label: string;
  used: number;
  max: number;
  unit: string;
}) {
  return (
    <div className="lc-measure">
      <p>
        <b>{label}</b>
        <span>
          {used} of {max} {unit}
        </span>
      </p>
      <div className="lc-ruler" aria-hidden>
        <i style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
      </div>
    </div>
  );
}

export function DirectionC({ story }: { story: HomeStory }) {
  const words = story.words;
  const passed = story.scenes.filter((s) => s.check?.status !== "failed");
  return (
    <div className="lc">
      <header className="lc-top">
        <Link href="/welcome" className="lc-mark">
          Kiln
        </Link>
        <Link href={GET_STARTED.href} className="lc-cta lc-cta-small">
          {GET_STARTED.label}
        </Link>
      </header>

      <main>
        <section className="lc-hero">
          <div className="lc-copy">
            <h1>Describe your product once. Get its photos and its listing.</h1>
            <div className="lc-lede">
              <p>
                Kiln draws every exact frame from your numbers, stages the
                scenes around your real product, and checks each photo before
                you see it. This is a sample board. Its spec is live.
              </p>
              <Link href={GET_STARTED.href} className="lc-cta">
                {GET_STARTED.label}
              </Link>
            </div>
          </div>
          <SpecBench
            product={story.product}
            colours={swatches(story)}
            exact={story.exact}
            scenes={passed}
          />
        </section>

        <section className="lc-band">
          <div className="lc-head">
            <h2>Four photos were taken. One failed, and says so.</h2>
            <p>
              Kiln reads the letters on every take and compares them with the
              spec you just saw. A photo that does not match the product is
              shown as failed, with the reason.
            </p>
          </div>
          <ul className="lc-takes">
            {story.scenes.map((s) => {
              const ok = s.check?.status !== "failed";
              return (
                <li key={s.url} data-ok={ok}>
                  <Take scene={s} className="lc-take" />
                  <p>
                    <b>{ok ? "Passed" : "Failed"}</b>
                    {ok ? "Text 2/2 · letters match" : reason(s)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {words ? (
          <section className="lc-band">
            <div className="lc-head">
              <h2>The listing is measured too.</h2>
              <p>
                Title, description and tags are drafted from the spec and
                counted against {words.channel}'s limits. Kiln proposes a draft
                in your shop; you publish.
              </p>
            </div>
            <div className="lc-listing">
              <div className="lc-sheet">
                <h3>{words.title}</h3>
                <p>{words.description}</p>
                <ul>
                  {words.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="lc-measures">
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
                />
                <p className="lc-free">Drafted from the spec · free</p>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

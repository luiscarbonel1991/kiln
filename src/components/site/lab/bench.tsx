import Link from "next/link";
import {
  type BenchColour,
  BenchStage,
} from "@/components/site/lab/bench-stage";
import { TakePrint } from "@/components/site/take-print";
import { WaxDefs } from "@/components/site/wax";
import type { HomeStory } from "@/lib/home-story";
import { GET_STARTED } from "@/lib/site";

// Direction "the bench": a maker's cutting mat with the product lying on it.
// Its spec is a ticket a visitor can edit; the drawings follow as they type,
// the photos do not, and the page says why.

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
    <div className="bn-measure">
      <p>
        <b>{label}</b>
        <span>
          {used} of {max} {unit}
        </span>
      </p>
      <div className="bn-ruler" aria-hidden>
        <i style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
      </div>
    </div>
  );
}

export function Bench({ story }: { story: HomeStory }) {
  const words = story.words;
  const passed = story.scenes.filter((s) => s.check?.status !== "failed");
  return (
    <div className="bn">
      <WaxDefs />
      <header className="bn-top">
        <Link href="/welcome" className="bn-mark">
          Kiln
        </Link>
        <Link href={GET_STARTED.href} className="bn-cta bn-cta-small">
          {GET_STARTED.label}
        </Link>
      </header>

      <main>
        <section className="bn-hero">
          <div className="bn-copy">
            <h1>Describe your product once. Get its photos and its listing.</h1>
            <p>
              Kiln draws every exact frame from your numbers, stages your real
              product in the scenes a listing needs, and checks each photo
              before you see it.
            </p>
            <div className="bn-actions">
              <Link href={GET_STARTED.href} className="bn-cta">
                {GET_STARTED.label}
              </Link>
              <span>Nothing is paid without your ok.</span>
            </div>
          </div>
          <BenchStage
            product={story.product}
            colours={swatches(story)}
            exact={story.exact}
            scenes={passed}
          />
        </section>

        <section className="bn-band">
          <div className="bn-head">
            <h2>Four photos were taken. One failed, and says so.</h2>
            <p>
              Kiln reads the letters on every take and compares them with the
              spec. A photo that does not match the product is marked as failed,
              with the reason, and you decide.
            </p>
          </div>
          <ul className="bn-takes">
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
        </section>

        {words ? (
          <section className="bn-band">
            <div className="bn-head">
              <h2>The listing is measured too.</h2>
              <p>
                Title, description and tags are drafted from the spec and
                counted against {words.channel}'s limits. Kiln proposes a draft
                in your shop; you publish.
              </p>
            </div>
            <div className="bn-listing">
              <div className="bn-sheet">
                <h3>{words.title}</h3>
                <p>{words.description}</p>
                <ul>
                  {words.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="bn-measures">
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
                <p className="bn-free">Drafted from the spec · free</p>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

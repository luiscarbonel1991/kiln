import Link from "next/link";
import type { ReactNode } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { Take, takeAlt } from "@/components/site/take";
import type { HomeStory, StoryScene } from "@/lib/home-story";
import { GET_STARTED } from "@/lib/site";

// Direction A, "the listing": the page opens on the finished listing, as a
// buyer would see it, and every part of it says where it came from. The
// frames switch with radio inputs and :has(), so the page ships no script.

type Source = "paid" | "free" | "failed";

interface Frame {
  id: string;
  name: string;
  source: Source;
  thumb: ReactNode;
  full: ReactNode;
  note: ReactNode;
}

const reason = (scene: StoryScene) =>
  scene.check?.label.replace(/^check failed · /, "") ?? "";

function frames(story: HomeStory): Frame[] {
  const passed = story.scenes.filter((s) => s.check?.status !== "failed");
  const failed = story.scenes.filter((s) => s.check?.status === "failed");
  const scene = (s: StoryScene, n: number, source: Source): Frame => ({
    id: `la-${source}-${n}`,
    name: s.label,
    source,
    thumb: <Take scene={s} alt="" className="la-fill" />,
    full: <Take scene={s} eager={n === 0} className="la-fill" />,
    note:
      source === "failed" ? (
        <>
          <b>Failed its check, left out.</b> {reason(s)}. Kiln shows a failed
          take as failed; you decide whether to try again.
        </>
      ) : (
        <>
          <b>Checked against the product:</b> text 2/2, letters match. Made by
          an image model, priced before it ran.
        </>
      ),
  });
  return [
    ...passed.map((s, n) => scene(s, n, "paid")),
    ...story.exact.map(
      (f, n): Frame => ({
        id: `la-free-${n}`,
        name: f.label,
        source: "free",
        thumb: <ExactSlotArt view={f.view} aspect={f.aspect} />,
        full: <ExactSlotArt view={f.view} aspect={f.aspect} />,
        note: (
          <>
            <b>Drawn from the spec, free.</b> The same numbers the maker typed,
            at every channel's size.
          </>
        ),
      }),
    ),
    ...failed.map((s, n) => scene(s, n, "failed")),
  ];
}

function Listing({ story }: { story: HomeStory }) {
  const all = frames(story);
  const p = story.product;
  const words = story.words;
  return (
    <div className="la-listing">
      <fieldset className="la-thumbs">
        <legend className="sr-only">The listing's photos</legend>
        {all.map((f, n) => (
          <label key={f.id} className="la-thumb" data-source={f.source}>
            <input
              type="radio"
              name="la-frame"
              value={f.id}
              defaultChecked={n === 0}
              className="sr-only"
            />
            <span className="la-thumb-art" aria-hidden>
              {f.thumb}
            </span>
            <span className="sr-only">
              {f.name}
              {f.source === "failed" ? ", failed its check" : ""}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="la-stage">
        {all.map((f) => (
          <figure key={f.id} className="la-frame" data-frame={f.id}>
            <div className="la-frame-art">{f.full}</div>
            <figcaption className="la-note" data-source={f.source}>
              {f.note}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="la-info">
        {words ? (
          <div>
            <h2 className="la-title">{words.title}</h2>
            <p className="la-count">
              {words.title.length} of {words.titleMax} characters{" "}
              {words.channel} allows · drafted from the spec
            </p>
          </div>
        ) : null}
        {p.price ? <p className="la-price">${p.price}</p> : null}
        <div className="la-field">
          <span className="la-label">Colour</span>
          <ul className="la-colours">
            {p.colours.map((c) => (
              <li key={c.key}>
                <span
                  className="la-swatch"
                  style={{ backgroundColor: c.face }}
                />
                {c.name}
              </li>
            ))}
          </ul>
        </div>
        {p.wording.map((w) => (
          <div key={w.label} className="la-field">
            <span className="la-label">{w.label}</span>
            <span className="la-input">{w.example}</span>
          </div>
        ))}
        {words ? (
          <div className="la-field">
            <span className="la-label">
              Tags · {words.tags.length} of {words.tagMax}
            </span>
            <ul className="la-tags">
              {words.tags.slice(0, 6).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="la-publish">
          A draft in your shop. Kiln proposes; you publish.
        </p>
      </div>
    </div>
  );
}

export function DirectionA({ story }: { story: HomeStory }) {
  const p = story.product;
  const failed = story.scenes.find((s) => s.check?.status === "failed");
  return (
    <div className="la">
      <header className="la-top">
        <Link href="/welcome" className="la-mark">
          Kiln
        </Link>
        <Link href={GET_STARTED.href} className="la-cta la-cta-small">
          {GET_STARTED.label}
        </Link>
      </header>

      <main>
        <section className="la-hero">
          <div className="la-copy">
            <h1>Your product, photographed and listed. Every photo checked.</h1>
            <p>
              Describe what you make once. Kiln draws the exact frames, stages
              the scenes around your real product, writes the listing to each
              shop's limits, and checks every photo before you see it.
            </p>
            <div className="la-actions">
              <Link href={GET_STARTED.href} className="la-cta">
                {GET_STARTED.label}
              </Link>
              <span>Nothing is paid without your ok.</span>
            </div>
            <p className="la-aside">
              On the right: the listing Kiln made for a sample cutting board.
              Pick any photo to see where it came from.
            </p>
          </div>
          <Listing story={story} />
        </section>

        <section className="la-band">
          <div className="la-band-head">
            <h2>These frames cost nothing.</h2>
            <p>
              The maker typed six things: {p.size}, {p.material},{" "}
              {p.finish.toLowerCase()}, {p.colours.length} colours, a family
              name, ${p.price}. Kiln drew these from them. Change a number and
              they redraw.
            </p>
          </div>
          <ul className="la-exact">
            {story.exact.map((f) => (
              <li key={f.label}>
                <div className="la-sheet">
                  <ExactSlotArt view={f.view} aspect={f.aspect} />
                </div>
                <p>
                  <b>{f.label}</b>
                  <span className="la-free">Drawn from the spec · free</span>
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="la-band la-proof">
          <div className="la-band-head">
            <h2>Kiln took four photos. Three made the listing.</h2>
            <p>
              An image model sets the scene; Kiln then reads the letters on
              every take and compares them with your product. A take that fails
              is shown as failed, with the reason.
            </p>
          </div>
          <ul className="la-takes">
            {story.scenes.map((s) => {
              const ok = s.check?.status !== "failed";
              return (
                <li key={s.url} data-ok={ok}>
                  <Take scene={s} className="la-take" alt={takeAlt(s)} />
                  <p className="la-verdict">
                    <b>{ok ? "Passed" : "Failed"}</b>
                    {ok ? "Text 2/2 · letters match" : reason(s)}
                  </p>
                </li>
              );
            })}
          </ul>
          {failed ? (
            <p className="la-proof-foot">
              The fourth take never reached the listing. That is the point of
              the check.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

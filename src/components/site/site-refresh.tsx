import { TakePrint } from "@/components/site/take-print";
import type { SiteKit } from "@/lib/site-kit";

// Before and after: refreshing the photos of a listing that already sells.
// The "before" is a marked placeholder until a real one is supplied.
export function SiteRefresh({ kit }: { kit: SiteKit }) {
  return (
    <section className="kl-band kl-refresh" aria-labelledby="refresh-title">
      <div className="kl-head">
        <h2 id="refresh-title">Already selling it? Replace the weak photo.</h2>
        <p>
          Most work is not a new listing. Upload the photos your listing shows
          today, mark which stay and which go, and Kiln makes the replacements
          from the product. Only what you replace is priced.
        </p>
      </div>
      <div className="kl-swap">
        <figure className="kl-before">
          <div className="kl-before-art" data-placeholder>
            <span>
              Placeholder
              <small>A real listing photo, as it is today, goes here.</small>
            </span>
          </div>
          <figcaption>
            <b>Photo 1 · live now</b>
            <span>The one your buyers see today</span>
          </figcaption>
        </figure>
        <svg className="kl-arrow" viewBox="0 0 120 40" aria-hidden>
          <path d="M4 22 C34 8 70 8 108 20" pathLength={1} />
          <path d="M94 8 L110 20 L92 30" pathLength={1} />
        </svg>
        <TakePrint
          take={kit.takes.hero}
          tilt={1.5}
          className="kl-new"
          title="Photo 1 · Kiln's take"
          note="Checked · $0.12, shown before it ran"
        />
      </div>
    </section>
  );
}

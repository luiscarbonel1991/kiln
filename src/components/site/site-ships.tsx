import { TakePrint } from "@/components/site/take-print";
import type { SiteKit } from "@/lib/site-kit";

// Where a kit goes, what Kiln reads back afterwards, and the two ways to work
// with it: in words, or through the maker's own assistant.
export function SiteShips({ kit }: { kit: SiteKit }) {
  return (
    <>
      <section className="kl-band" aria-labelledby="ships-title">
        <div className="kl-head">
          <h2 id="ships-title">Kiln proposes. You publish.</h2>
          <p>
            A finished kit leaves as a draft, a set of posts or a folder. Kiln
            never publishes for you and never touches a listing that is live.
          </p>
        </div>
        <div className="kl-ships">
          <ul className="kl-routes">
            <li>
              <b>A draft in your Etsy shop</b>
              <span>
                The text, the approved photos in order and the price, waiting in
                your drafts for your last look.
              </span>
            </li>
            <li>
              <b>Instagram, from the same scenes</b>
              <span>
                A carousel, a story and a square post. The scenes your listing
                already paid for are reused at no cost.
              </span>
            </li>
            <li>
              <b>A zip for anywhere else</b>
              <span>
                Every file at the right size, numbered in order, with a record
                of what made each one and what it cost.
              </span>
            </li>
          </ul>
          <TakePrint
            take={kit.takes.hook}
            tilt={2}
            className="kl-ships-print"
            title="Instagram · slide 1"
            note="Checked · $0.06"
          />
        </div>
      </section>

      <section
        className="kl-band kl-after kl-solo"
        aria-labelledby="after-title"
      >
        <div>
          <h2 id="after-title">Then it tells you whether it worked.</h2>
          <p>
            Kiln reads your shop's orders and revenue 14 and 30 days after the
            new photos go live, beside the 30 days before. When your choices
            agree twice, it proposes a lesson, and uses it in the next kit only
            once you keep it.
          </p>
        </div>
      </section>
    </>
  );
}

import Link from "next/link";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { Print } from "@/components/site/print";
import { TakePrint } from "@/components/site/take-print";
import { GET_STARTED } from "@/lib/site";
import type { SiteKit } from "@/lib/site-kit";

// The page's opening: the outcome in one sentence, one way in, and the kit
// itself as prints dealt onto the table, each marked with its check.
export function SiteHero({ kit }: { kit: SiteKit }) {
  const colours = kit.frames[0];
  return (
    <section className="kl-hero">
      <div className="kl-hero-copy">
        <h1>Your product, photographed, listed and checked.</h1>
        <p>
          Describe what you make once. Kiln draws the exact frames, stages your
          real product in the scenes a listing needs, writes the text to your
          shop's limits, and checks every photo before you see it.
        </p>
        <div className="kl-actions">
          <Link
            href={GET_STARTED.href}
            data-testid="site-start-hero"
            className="kl-cta"
          >
            {GET_STARTED.label}
          </Link>
          <span>Nothing is paid without your ok.</span>
        </div>
        <p className="kl-aside">
          On the table: what Kiln made for one sample coaster. One photo did not
          pass its check, and says so.
        </p>
      </div>

      <div className="kl-pile">
        <TakePrint
          take={kit.takes.lifestyle}
          tilt={2.5}
          className="kl-p2"
          eager
          at={1300}
        />
        <TakePrint
          take={kit.takes.hero}
          tilt={-3}
          className="kl-p1"
          eager
          at={900}
        />
        {colours ? (
          <Print
            tilt={3.5}
            className="kl-p4"
            tone="free"
            title={colours.label}
            note="Drawn from the spec · free"
          >
            <ExactSlotArt view={colours.view} aspect="1:1" plate={kit.plate} />
          </Print>
        ) : null}
        {kit.words ? (
          <div className="kl-slip kl-p5">
            <b>{kit.words.title}</b>
            <span>
              Title · {kit.words.title.length} of {kit.words.titleMax}{" "}
              characters
            </span>
          </div>
        ) : null}
        <TakePrint
          take={kit.takes.failed}
          tilt={-2}
          className="kl-p3"
          eager
          at={1700}
          note="Failed its check: letters too thin"
        />
      </div>
    </section>
  );
}

import Link from "next/link";
import { GET_STARTED } from "@/lib/site";

// The close of the public page: one way in.
export function SiteClose() {
  return (
    <section className="kl-close">
      <h2>Start with one product.</h2>
      <p>
        Type it in, or start from a photo, a design file or your catalog.
        Nothing is paid without your ok.
      </p>
      <Link
        href={GET_STARTED.href}
        data-testid="site-start-close"
        className="kl-cta"
      >
        {GET_STARTED.label}
      </Link>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="kl-foot">
      <span className="kl-mark">Kiln</span>
      <span>
        The sample coaster's photos, frames, video and text were made by Kiln on
        2026-11-10 and 2026-11-11. Open source under the AGPL.
      </span>
    </footer>
  );
}

import Link from "next/link";
import { GET_STARTED } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="kl-top">
      <Link href="/welcome" className="kl-mark">
        Kiln
      </Link>
      <nav aria-label="This page">
        <a href="#kit">What it makes</a>
        <a href="#agent">With your AI</a>
        <a href="#cost">What it costs</a>
        <Link
          href={GET_STARTED.href}
          data-testid="site-start-header"
          className="kl-cta kl-cta-small"
        >
          {GET_STARTED.label}
        </Link>
      </nav>
    </header>
  );
}

import type { Metadata } from "next";
import { Reveal } from "@/components/site/reveal";
import { SiteAgent } from "@/components/site/site-agent";
import { SiteCost } from "@/components/site/site-cost";
import { SiteClose, SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteHero } from "@/components/site/site-hero";
import { SiteMade } from "@/components/site/site-made";
import { SiteRefresh } from "@/components/site/site-refresh";
import { SiteShips } from "@/components/site/site-ships";
import { SiteStarts } from "@/components/site/site-starts";
import { WaxDefs } from "@/components/site/wax";
import { SITE_AUDIENCE } from "@/lib/site-audience";
import { siteKit } from "@/lib/site-kit";
import "@/components/site/parts.css";
import "./welcome/landing.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Kiln · Your product, photographed, listed and checked",
  description: `Open source, for ${SITE_AUDIENCE}. Describe a product once: Kiln draws the exact frames, stages it in scenes, writes the listing to your shop's limits and checks every photo. Use it yourself or connect your AI.`,
};

// Home is the public page: what Kiln makes, told with one sample product's
// kit. Built once, with no database and nothing paid; the maker's own work is
// at /projects.
export default function HomePage() {
  const kit = siteKit();
  return (
    <div className="kl">
      <WaxDefs />
      <SiteHeader />
      <main>
        <SiteHero kit={kit} />
        <SiteRefresh kit={kit} />
        <SiteStarts />
        <SiteAgent />
        <SiteMade kit={kit} />
        <SiteShips kit={kit} />
        <SiteCost kit={kit} />
        <SiteClose />
      </main>
      <SiteFooter />
      <Reveal />
    </div>
  );
}

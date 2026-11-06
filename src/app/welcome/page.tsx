import type { Metadata } from "next";
import { KitSteps } from "@/components/site/kit-steps";
import { SiteClose, SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SiteHero } from "@/components/site/site-hero";
import { SitePricing } from "@/components/site/site-pricing";
import { sampleStory } from "@/lib/home-story";
import "./landing.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Kiln · Everything your product needs before the sale",
  description:
    "Photos, SVG designs, listing text and every frame each channel asks for, made from your product and checked before you see them.",
};

// The public page, for a visitor without an account: what Kiln makes, told
// with the sample product. Built once, with no database and nothing paid.
export default function WelcomePage() {
  const story = sampleStory();
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-28 px-4 pt-8 pb-24 sm:gap-36 sm:px-8">
        <SiteHero lead={story.scenes[0]} />
        <KitSteps story={story} />
        <SitePricing />
        <SiteClose />
      </main>
      <SiteFooter />
    </div>
  );
}

import type { Metadata } from "next";
import { DirectionA } from "@/components/site/lab/direction-a";
import { bricolage } from "@/components/site/lab/fonts";
import { sampleStory } from "@/lib/home-story";
import "@/components/site/lab/lab-a.css";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Kiln · direction A" };

export default function LabA() {
  return (
    <div className={`${bricolage.variable} flex min-h-full flex-col`}>
      <DirectionA story={sampleStory()} />
    </div>
  );
}

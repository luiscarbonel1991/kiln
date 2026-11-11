import type { Metadata } from "next";
import { DirectionC } from "@/components/site/lab/direction-c";
import { archivo } from "@/components/site/lab/fonts";
import { sampleStory } from "@/lib/home-story";
import "@/components/site/lab/lab-c.css";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Kiln · direction C" };

export default function LabC() {
  return (
    <div className={`${archivo.variable} flex min-h-full flex-col`}>
      <DirectionC story={sampleStory()} />
    </div>
  );
}

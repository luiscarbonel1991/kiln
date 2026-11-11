import type { Metadata } from "next";
import { DirectionB } from "@/components/site/lab/direction-b";
import { sampleStory } from "@/lib/home-story";
import "@/components/site/lab/lab-b.css";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Kiln · direction B" };

export default function LabB() {
  return (
    <div className="flex min-h-full flex-col">
      <DirectionB story={sampleStory()} />
    </div>
  );
}

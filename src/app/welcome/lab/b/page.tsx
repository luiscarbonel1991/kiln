import type { Metadata } from "next";
import { Bench } from "@/components/site/lab/bench";
import { bricolage } from "@/components/site/lab/fonts";
import { sampleStory } from "@/lib/home-story";
import "@/components/site/parts.css";
import "@/components/site/lab/bench.css";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Kiln · the bench" };

export default function LabBench() {
  return (
    <div className={`${bricolage.variable} flex min-h-full flex-col`}>
      <Bench story={sampleStory()} />
    </div>
  );
}

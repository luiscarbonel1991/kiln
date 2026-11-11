import type { Metadata } from "next";
import { Table } from "@/components/site/lab/table";
import { sampleStory } from "@/lib/home-story";
import "@/components/site/parts.css";
import "@/components/site/lab/table.css";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Kiln · the table" };

export default function LabTable() {
  return (
    <div className="flex min-h-full flex-col">
      <Table story={sampleStory()} />
    </div>
  );
}

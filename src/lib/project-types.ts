import type { ProjectType } from "@/domain/project";

// How the four project types read in the UI (ROADMAP "Domain model").
export const PROJECT_TYPES: {
  type: ProjectType;
  label: string;
  description: string;
}[] = [
  {
    type: "listing-kit",
    label: "Listing kit",
    description: "Photos for a sale destination, from the product spec.",
  },
  {
    type: "content",
    label: "Content",
    description: "Carousels and posts for a content destination.",
  },
  {
    type: "launch",
    label: "Launch",
    description: "One product on every destination, from the same scenes.",
  },
  {
    type: "design",
    label: "Design",
    description: "Image to SVG: line art for a new design (opens the studio).",
  },
];

export function projectTypeLabel(type: ProjectType): string {
  return PROJECT_TYPES.find((t) => t.type === type)?.label ?? type;
}

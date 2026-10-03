import { z } from "zod";

// The four project types (ROADMAP "Domain model"). Design = image -> SVG; the
// other three turn a product into images for destinations.
export const ProjectType = z.enum([
  "design",
  "listing-kit",
  "content",
  "launch",
]);
export type ProjectType = z.infer<typeof ProjectType>;

import { z } from "zod";

export const BrandProfile = z.object({
  id: z.string(),
  name: z.string(),
  palette: z.array(z.string()).min(1),
  fonts: z.object({ display: z.string(), body: z.string() }),
  tone: z.array(z.string()),
  visualStyle: z.array(z.string()),
  doList: z.array(z.string()).default([]),
  dontList: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});
export type BrandProfile = z.infer<typeof BrandProfile>;

import { z } from "zod";

export const MasterAsset = z.object({
  id: z.string(),
  origin: z.enum(["upload", "generated"]),
  sourcePrompt: z.string().nullable(),
  assetUrl: z.string(),
  mime: z.string(),
});
export type MasterAsset = z.infer<typeof MasterAsset>;

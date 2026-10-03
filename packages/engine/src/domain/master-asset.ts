import { z } from "zod";

// The anchor image: uploaded, generated in the chat, or the product's own
// reference (a product-first project: the product photo or its plate).
export const MasterAsset = z.object({
  id: z.string(),
  origin: z.enum(["upload", "generated", "product"]),
  sourcePrompt: z.string().nullable(),
  assetUrl: z.string(),
  mime: z.string(),
});
export type MasterAsset = z.infer<typeof MasterAsset>;

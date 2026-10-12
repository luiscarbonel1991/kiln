import { z } from "zod";

export type ImageOp = "generate" | "edit" | "compose";

export const Capabilities = z.object({
  generate: z.boolean(),
  edit: z.boolean(),
  compose: z.boolean(),
  maxRefs: z.number().int().nonnegative(),
  aspectRatios: z.array(z.string()),
});
export type Capabilities = z.infer<typeof Capabilities>;

// Static capability data per provider — no env, no SDK, so the client can read it
// for UI gating. The providers layer re-exports these (single source of truth).
export const PROVIDER_CAPABILITIES: Record<"google" | "openai", Capabilities> =
  {
    google: Capabilities.parse({
      generate: true,
      edit: true,
      compose: true,
      maxRefs: 3,
      aspectRatios: ["1:1", "4:5", "16:9", "9:16", "2:3"],
    }),
    openai: Capabilities.parse({
      generate: true,
      edit: true,
      compose: false,
      // The Images API takes up to 16 images for GPT image models; Kiln
      // sends the reference plus these, like Google.
      maxRefs: 3,
      aspectRatios: ["1:1", "2:3", "3:2"],
    }),
  };

// Non-throwing predicate over a bare Capabilities (UI: disable invalid ops / refs).
export function canUse(caps: Capabilities, op: ImageOp, refs = 0): boolean {
  if (!caps[op]) return false;
  if (refs > caps.maxRefs) return false;
  return true;
}

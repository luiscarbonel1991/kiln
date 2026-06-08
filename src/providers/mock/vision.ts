import { SEED_BRAND } from "@/domain/seed";
import { BaseUnderstanding } from "@/domain/understanding";
import type { VisionProvider } from "@/providers/interfaces";

// MOCK: returns a fixed understanding (mockup EXTRACTED values). Replaced by a real
// VisionProvider in Phase 3.
export const mockVisionProvider: VisionProvider = {
  async analyze(_input) {
    return BaseUnderstanding.parse({
      subject: "glazed stoneware pitcher, matte cream finish",
      materials: "stoneware, reactive glaze",
      lighting: "soft directional light, upper-left",
      composition: "centered, slight high angle",
      mood: "calm, handmade, editorial",
      palette: SEED_BRAND.palette,
    });
  },
};

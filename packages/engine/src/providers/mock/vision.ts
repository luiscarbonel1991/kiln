import { SEED_BRAND } from "@/domain/seed";
import { BaseUnderstanding } from "@/domain/understanding";
import type { VisionProvider } from "@/providers/interfaces";
import type { ProductDraft } from "@/providers/text-prompts";

// What mock runs (KILN_PROVIDERS=mock) and key-free tests read a photo as.
export const MOCK_UNDERSTANDING: BaseUnderstanding = BaseUnderstanding.parse({
  subject: "glazed stoneware pitcher, matte cream finish",
  productType: "ceramic pitcher",
  useContext: "sits on a kitchen counter, dining table or open shelf",
  sceneProps: "",
  materials: "stoneware, reactive glaze",
  lighting: "soft directional light, upper-left",
  composition: "centered, slight high angle",
  mood: "calm, handmade, editorial",
  palette: SEED_BRAND.palette,
});

// What a mock run drafts from any photo.
export const MOCK_PRODUCT_DRAFT: ProductDraft = {
  name: "Glazed stoneware pitcher",
  whatItIs: "pitcher",
  material: "glazed stoneware",
  treatment: "printed",
  colours: [{ name: "Cream", hex: "#F2E6D0" }],
  wording: [],
  useContext: "a kitchen counter",
};

export const mockVisionProvider: VisionProvider = {
  async analyze(_input, options) {
    return { value: MOCK_UNDERSTANDING, model: options.model };
  },
  async draftProduct(_input, options) {
    return { value: MOCK_PRODUCT_DRAFT, model: options.model };
  },
};

"use server";

import { MakerProfileData } from "@/lib/pricing/types";
import { getMakerPricing, saveMakerPricing } from "@/server/maker-repository";

// The cost calculator's saved defaults for the current maker. Server Functions
// are POST-reachable: the Zod parse is the trust boundary.
export async function getMakerPricingAction(): Promise<MakerProfileData | null> {
  return getMakerPricing();
}

export async function saveMakerPricingAction(input: unknown): Promise<void> {
  await saveMakerPricing(MakerProfileData.parse(input));
}

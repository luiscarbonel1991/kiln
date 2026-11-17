"use server";

import { z } from "zod";
import { assertModuleEnabled } from "@/modules/enabled";
import { parseSvgGeometry } from "@/modules/laser-pricing/geometry";
import {
  getMakerPricing,
  saveMakerPricing,
} from "@/modules/laser-pricing/repository";
import { MakerProfileData, SvgGeometry } from "@/modules/laser-pricing/types";
import { fetchAsset } from "@/providers/asset-bytes";
import { makerAction } from "@/server/guarded";

// The laser cost calculator's Server Functions (an optional module: each one
// refuses unless KILN_MODULES lists "laser-pricing"). They are POST-reachable:
// the Zod parses are the trust boundary.

const Input = z.object({ vectorUrl: z.string().url() });

// Fetch a vectorized .svg and derive its cut/score length, layers, bbox and
// engrave-fill estimate. Pricing math runs client-side from this result.
export const analyzeSvgGeometryAction = makerAction(
  async (_maker, input: unknown): Promise<SvgGeometry> => {
    assertModuleEnabled("laser-pricing");
    const { vectorUrl } = Input.parse(input);
    const { bytes } = await fetchAsset(vectorUrl);
    return SvgGeometry.parse(parseSvgGeometry(bytes.toString("utf8")));
  },
);

// The calculator's saved defaults for the current maker.
export const getMakerPricingAction = makerAction(
  async (maker): Promise<MakerProfileData | null> => {
    assertModuleEnabled("laser-pricing");
    return getMakerPricing(maker);
  },
);

export const saveMakerPricingAction = makerAction(
  async (maker, input: unknown): Promise<void> => {
    assertModuleEnabled("laser-pricing");
    await saveMakerPricing(maker, MakerProfileData.parse(input));
  },
);

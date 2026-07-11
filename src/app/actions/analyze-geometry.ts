"use server";

import { z } from "zod";
import { parseSvgGeometry } from "@/lib/pricing/geometry";
import { SvgGeometry } from "@/lib/pricing/types";
import { fetchAsset } from "@/providers/asset-bytes";

const Input = z.object({ vectorUrl: z.string().url() });

// Server Function: fetch a vectorized .svg and derive its cut/score length, layers,
// bbox and engrave-fill estimate. The Zod parse is the trust boundary (Server
// Functions are POST-reachable). Pricing math runs client-side from this result.
export async function analyzeSvgGeometryAction(
  input: unknown,
): Promise<SvgGeometry> {
  const { vectorUrl } = Input.parse(input);
  const { bytes } = await fetchAsset(vectorUrl);
  return SvgGeometry.parse(parseSvgGeometry(bytes.toString("utf8")));
}

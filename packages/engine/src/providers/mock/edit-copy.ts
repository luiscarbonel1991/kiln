import { randomUUID } from "node:crypto";
import {
  fetchAsset,
  isAllowedAssetUrl,
  storeAsset,
} from "@/providers/asset-bytes";
import { GenerationResult } from "@/providers/types";

// A mock run's edit (KILN_PROVIDERS=mock): a stored copy of the reference, so
// what follows an edit (vectorize, deliver) reads a real image, at its own
// address so a re-roll is a new output — the board's mock does the same. A
// reference Kiln cannot read (another mock's stub) gives a stub back.
export async function mockEditCopy(
  masterAssetUrl: string,
  provider: "openai" | "google",
  model: string,
): Promise<GenerationResult> {
  if (!isAllowedAssetUrl(masterAssetUrl)) {
    return GenerationResult.parse({
      assets: [
        {
          id: `${provider}-edit-mock`,
          url: `https://stub.local/${provider}/edit-${randomUUID()}.png`,
          mime: "image/png",
        },
      ],
      provider,
      model,
    });
  }
  const master = await fetchAsset(masterAssetUrl);
  const url = await storeAsset(
    new Uint8Array(master.bytes),
    master.mime,
    "cards",
  );
  return GenerationResult.parse({
    assets: [{ id: randomUUID(), url, mime: master.mime }],
    provider,
    model,
  });
}

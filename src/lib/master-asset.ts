import { MasterAsset } from "@/domain/master-asset";

// Structural shape of the provider GenerationResult consumed here. Declared
// locally (not imported from @/providers) so this isomorphic module never
// references the providers barrel — keeping the client bundle provider-free.
interface GenerationLike {
  assets: { id: string; url: string; mime: string }[];
  provider: string;
  model: string;
}

export function masterAssetFromUpload(input: {
  assetUrl: string;
  mime: string;
}): MasterAsset {
  return MasterAsset.parse({
    id: crypto.randomUUID(),
    origin: "upload",
    sourcePrompt: null,
    assetUrl: input.assetUrl,
    mime: input.mime,
  });
}

export function masterAssetFromGeneration(
  result: GenerationLike,
  prompt: string,
): MasterAsset {
  const asset = result.assets[0];
  if (!asset) {
    throw new Error("GenerationResult has no assets");
  }
  return MasterAsset.parse({
    id: crypto.randomUUID(),
    origin: "generated",
    sourcePrompt: prompt,
    assetUrl: asset.url,
    mime: asset.mime,
  });
}

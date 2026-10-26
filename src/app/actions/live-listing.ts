"use server";

import { MAX_UPLOAD_BYTES } from "@/components/studio/constants";
import { imageSize, rasterType, sizeAspect } from "@/domain/image-type";
import { storeAsset } from "@/providers/asset-bytes";

export interface StoredListingPhoto {
  url: string;
  // The photo's own proportions: a kept photo is drawn and delivered uncropped.
  aspect: string;
  width: number;
  height: number;
}

// A live listing's photo, as the maker has it (P0-2): read by its bytes (PNG,
// JPEG or WebP, at most 15 MB), stored by them, so the same photo twice is
// one file. Kiln never fetches the listing or its photos.
export async function uploadListingPhotoAction(
  formData: FormData,
): Promise<StoredListingPhoto | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No photo was sent." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `${file.name} is larger than 15 MB.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = rasterType(bytes);
  const size = imageSize(bytes);
  if (!mime || !size) {
    return {
      error: `${file.name}: add the listing's photo as a PNG, JPEG or WebP.`,
    };
  }
  const url = await storeAsset(bytes, mime, "listings", { byContent: true });
  return { url, aspect: sizeAspect(size), ...size };
}

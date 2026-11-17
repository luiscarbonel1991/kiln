"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import { getStorageProvider } from "@/providers/registry";
import { requireMaker } from "@/server/session";

const MimeSchema = z.enum(ACCEPTED_IMAGE_MIME);

const EXTENSION: Record<z.infer<typeof MimeSchema>, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Server Function: stores an uploaded master image in object storage and returns a
// durable public URL. The only client path into @/providers (storage). Zod + size
// checks are the trust boundary (Server Functions are POST-reachable).
export async function uploadMasterImage(
  formData: FormData,
): Promise<{ url: string; mime: string }> {
  await requireMaker();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("No file provided.");
  }
  const mime = MimeSchema.parse(file.type);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Image is larger than 15 MB.");
  }
  const body = new Uint8Array(await file.arrayBuffer());
  const key = `masters/${randomUUID()}.${EXTENSION[mime]}`;
  const { url } = await getStorageProvider().put({
    key,
    body,
    contentType: mime,
  });
  return { url, mime };
}

import { randomUUID } from "node:crypto";
import { getStorageProvider } from "@/providers/storage";

export interface FetchedAsset {
  bytes: Buffer;
  base64: string;
  mime: string;
}

const FETCH_TIMEOUT_MS = 30_000;

// Fetch image/video bytes from a URL (S3, http, data:) for use as model input.
// Bounded, so a stalled storage read never holds a paid job open.
export async function fetchAsset(url: string): Promise<FetchedAsset> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch asset (${res.status}): ${url}`);
  }
  const mime =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, base64: bytes.toString("base64"), mime };
}

const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
};

// Store generated output bytes in object storage; returns a durable public URL.
export async function storeAsset(
  bytes: Uint8Array,
  mime: string,
  prefix: string,
): Promise<string> {
  const ext = EXTENSION[mime] ?? "bin";
  const { url } = await getStorageProvider().put({
    key: `${prefix}/${randomUUID()}.${ext}`,
    body: bytes,
    contentType: mime,
  });
  return url;
}

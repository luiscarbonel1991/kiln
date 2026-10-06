import { randomUUID } from "node:crypto";
import { getStorageProvider } from "@/providers/storage";
import { env } from "../env";

export interface FetchedAsset {
  bytes: Buffer;
  base64: string;
  mime: string;
}

const FETCH_TIMEOUT_MS = 30_000;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const DATA_IMAGE = /^data:image\/[\w.+-]+[;,]/i;

// Where the server may fetch asset bytes from: data: images, Kiln's own
// storage (what its provider publishes under) and the origins an instance adds in
// KILN_ASSET_ORIGINS. Anything else — another host, a private address, a
// credentialed URL — is refused, so neither a client payload nor a product
// package can make the server fetch an arbitrary URL.
export function isAllowedAssetUrl(url: string): boolean {
  if (url.startsWith("data:")) return DATA_IMAGE.test(url);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  const storage = storageBase();
  if (
    storage &&
    parsed.origin === storage.origin &&
    parsed.pathname.startsWith(storage.pathname)
  ) {
    return true;
  }
  return env.KILN_ASSET_ORIGINS.some(
    (origin) => new URL(origin).origin === parsed.origin,
  );
}

// The URL every stored asset starts with (its public base and bucket); null
// when storage is not configured.
function storageBase(): URL | null {
  try {
    return new URL(getStorageProvider().publicUrl(""));
  } catch {
    return null;
  }
}

// What an error may say about a URL: its origin, never its path or query.
function describeUrl(url: string): string {
  if (url.startsWith("data:")) return "a data: URL that is not an image";
  try {
    return new URL(url).origin;
  } catch {
    return "an invalid URL";
  }
}

export function assertAllowedAssetUrl(url: string): void {
  if (!isAllowedAssetUrl(url)) {
    throw new Error(
      `Kiln does not fetch assets from ${describeUrl(url)}: only its own storage, data: images and the origins in KILN_ASSET_ORIGINS.`,
    );
  }
}

const tooLarge = () =>
  new Error(
    `The asset is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB, the most Kiln fetches.`,
  );

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ASSET_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Fetch image/video bytes from an allowed URL (storage, data:, an allowed
// origin) for use as model input. Bounded in time and size, and redirects are
// refused (an allowed host could otherwise send the fetch anywhere).
export async function fetchAsset(url: string): Promise<FetchedAsset> {
  assertAllowedAssetUrl(url);
  if (url.startsWith("data:") && url.length > MAX_ASSET_BYTES * 1.4) {
    throw tooLarge();
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch asset (${res.status}) from ${describeUrl(url)}`,
    );
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_ASSET_BYTES) {
    throw tooLarge();
  }
  const mime =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const bytes = await readCapped(res);
  return { bytes, base64: bytes.toString("base64"), mime };
}

const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/zip": "zip",
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

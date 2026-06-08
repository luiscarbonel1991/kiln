// Object-storage abstraction. The backend (MinIO now, real S3/Vercel Blob later)
// sits behind this interface so swapping it is a new adapter + env, no app change.
// Server-only — reached only via the upload Server Action, like the AI providers.
export type StorageProviderId = "s3";

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface PutObjectResult {
  key: string;
  url: string;
}

export interface StorageProvider {
  put(input: PutObjectInput): Promise<PutObjectResult>;
  publicUrl(key: string): string;
}

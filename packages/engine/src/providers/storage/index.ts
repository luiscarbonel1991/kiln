import type {
  StorageProvider,
  StorageProviderId,
} from "@/providers/storage/interface";
import { s3StorageProvider } from "@/providers/storage/s3";
import { env } from "../../env";

// Object storage selection. Kept separate from registry.ts (which pulls the image
// adapters) so the byte helpers can import it without an import cycle. One provider
// this pass (s3 → MinIO locally); selected by env so the backend swaps freely.
const STORAGE_PROVIDERS: Record<StorageProviderId, StorageProvider> = {
  s3: s3StorageProvider,
};

export function getStorageProvider(
  id: StorageProviderId = env.STORAGE_PROVIDER,
): StorageProvider {
  return STORAGE_PROVIDERS[id];
}

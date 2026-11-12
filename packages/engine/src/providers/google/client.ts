import { GoogleGenAI } from "@google/genai";
import { ProviderKeyMissing } from "@/providers/errors";
import { providerKey } from "@/providers/keys";
import { env } from "../../env";

// The GenAI client (server-only), built once per key: a key the maker
// replaces is used from the next call. hasGoogleKey lets adapters fall back
// to their mock when no key is configured (so the app and tests run without
// credentials).
let client: { key: string; sdk: GoogleGenAI } | null = null;

export function hasGoogleKey(): boolean {
  return env.KILN_PROVIDERS !== "mock" && Boolean(providerKey("google"));
}

// The key the Files API needs to download a finished video (server only).
export function googleApiKey(): string {
  const key = providerKey("google");
  if (!key) throw new ProviderKeyMissing("google");
  return key;
}

// No retryOptions: the SDK then makes a single request (checked on
// @google/genai 2.32.0), so a paid call is never repeated behind the queue's
// back; the queue and the direct-spend row own retries.
export function getGenAI(): GoogleGenAI {
  const key = googleApiKey();
  if (client?.key !== key) {
    client = { key, sdk: new GoogleGenAI({ apiKey: key }) };
  }
  return client.sdk;
}

// Since 2.29 the SDK continues a long answer in new requests, each billed,
// unless a call's config says not to. Every paid generateContent spreads this.
export const ONE_REQUEST = { automaticContinuation: false } as const;

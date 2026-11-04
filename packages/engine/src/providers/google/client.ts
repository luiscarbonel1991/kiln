import { GoogleGenAI } from "@google/genai";
import { env } from "../../env";

// Lazily-constructed singleton GenAI client (server-only — used only by the google
// adapters behind Server Actions). hasGoogleKey lets adapters fall back to their
// mock when no key is configured (so the app + tests run without credentials).
let client: GoogleGenAI | null = null;

export function hasGoogleKey(): boolean {
  return env.KILN_PROVIDERS !== "mock" && Boolean(env.GOOGLE_API_KEY);
}

// The key the Files API needs to download a finished video (server only).
export function googleApiKey(): string {
  if (!env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY is not set");
  return env.GOOGLE_API_KEY;
}

// No retryOptions: the SDK then makes a single request (checked on
// @google/genai 2.32.0), so a paid call is never repeated behind the queue's
// back; the queue and the direct-spend row own retries.
export function getGenAI(): GoogleGenAI {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not set");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
  }
  return client;
}

// Since 2.29 the SDK continues a long answer in new requests, each billed,
// unless a call's config says not to. Every paid generateContent spreads this.
export const ONE_REQUEST = { automaticContinuation: false } as const;

import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";

// Lazily-constructed singleton GenAI client (server-only — used only by the google
// adapters behind Server Actions). hasGoogleKey lets adapters fall back to their
// mock when no key is configured (so the app + tests run without credentials).
let client: GoogleGenAI | null = null;

export function hasGoogleKey(): boolean {
  return Boolean(env.GOOGLE_API_KEY);
}

export function getGenAI(): GoogleGenAI {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not set");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
  }
  return client;
}

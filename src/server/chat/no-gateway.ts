import { customProvider } from "ai";

// `ai` sends a model named by a string through Vercel's AI Gateway when no
// default provider is set. Kiln passes only its adapters' models (Luis,
// 2026-10-30: no dependency on Vercel), so a string id is refused here, never
// sent anywhere.
globalThis.AI_SDK_DEFAULT_PROVIDER = customProvider({});

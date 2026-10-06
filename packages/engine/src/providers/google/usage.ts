import type { GenerationUsage } from "@/providers/types";

// Gemini's usageMetadata as ours (what a finished call actually cost, domain
// costFromUsage). The prompt splits by modality; thinking is billed as output.
interface UsageMetadata {
  promptTokenCount?: number;
  promptTokensDetails?: { modality?: string; tokenCount?: number }[];
  candidatesTokenCount?: number;
  candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
  thoughtsTokenCount?: number;
}

const tokensOf = (
  details: UsageMetadata["promptTokensDetails"],
  modality: string,
): number | undefined => {
  const matching = details?.filter((d) => d.modality === modality);
  if (!matching || matching.length === 0) return undefined;
  return matching.reduce((sum, d) => sum + (d.tokenCount ?? 0), 0);
};

function input(meta: UsageMetadata) {
  const prompt = meta.promptTokenCount ?? 0;
  const image = tokensOf(meta.promptTokensDetails, "IMAGE") ?? 0;
  return {
    inputTextTokens: Math.max(0, prompt - image),
    inputImageTokens: Math.min(prompt, image),
  };
}

// An image model: the image tokens are its output; the text and thinking
// beside it bill at the text rate. Without a modality split every candidate
// token counts as image (the higher rate: never under-counted).
export function imageUsage(meta: unknown): GenerationUsage | undefined {
  const m = meta as UsageMetadata | null | undefined;
  if (!m || typeof m.promptTokenCount !== "number") return undefined;
  const candidates = m.candidatesTokenCount ?? 0;
  const image = tokensOf(m.candidatesTokensDetails, "IMAGE") ?? candidates;
  return {
    ...input(m),
    outputTokens: image,
    outputTextTokens:
      Math.max(0, candidates - image) + (m.thoughtsTokenCount ?? 0),
  };
}

// A text model: its answer and its thinking are the output.
export function textUsage(meta: unknown): GenerationUsage | undefined {
  const m = meta as UsageMetadata | null | undefined;
  if (!m || typeof m.promptTokenCount !== "number") return undefined;
  return {
    ...input(m),
    outputTokens: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0),
  };
}

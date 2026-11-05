// Deterministic placeholder gradient for generated images: stub provider URLs
// (https://stub.local/...) do not resolve, so we render a stable CSS gradient
// derived from the prompt instead.
// These hex literals are render-content (a faux photograph), not UI chrome.

const ASSET_PALETTE = ["#d9c3a5", "#b07a4e", "#6f5237", "#efe6d6", "#2e2620"];

export function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function gradientForSeed(seed: number): string {
  const a = ASSET_PALETTE[seed % 5];
  const b = ASSET_PALETTE[(seed + 2) % 5];
  const c = ASSET_PALETTE[(seed + 4) % 5];
  const x1 = 20 + ((seed * 37) % 60);
  const y1 = 15 + ((seed * 53) % 55);
  const x2 = 30 + ((seed * 71) % 55);
  const y2 = 40 + ((seed * 29) % 50);
  return [
    `radial-gradient(120% 120% at ${x1}% ${y1}%, ${a} 0%, transparent 56%)`,
    `radial-gradient(100% 100% at ${x2}% ${y2}%, ${b} 0%, transparent 52%)`,
    `linear-gradient(140deg, ${c} 0%, #efe6d6 95%)`,
  ].join(", ");
}

export function gradientForPrompt(prompt: string): string {
  return gradientForSeed(hashSeed(prompt));
}

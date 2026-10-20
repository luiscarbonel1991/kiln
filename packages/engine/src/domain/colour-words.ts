// Plain colour words for prompts: an image model reads "white raised letters"
// but not "#F2F2F2". The nearest of a small set of everyday names, by
// perceptual-ish distance (weighted RGB), is good enough to name a contrast
// colour the spec gives only as hex.

const NAMED: [string, string][] = [
  ["white", "#FFFFFF"],
  ["cream", "#F2E6D0"],
  ["beige", "#D9C5A0"],
  ["tan", "#C8A165"],
  ["gold", "#C9A227"],
  ["silver", "#C0C0C0"],
  ["grey", "#808080"],
  ["charcoal", "#3A3A3A"],
  ["black", "#111111"],
  ["brown", "#6B4423"],
  ["dark brown", "#3D2B1F"],
  ["red", "#B03A2E"],
  ["orange", "#E67E22"],
  ["yellow", "#F1C40F"],
  ["green", "#2E7D32"],
  ["teal", "#2E6E73"],
  ["blue", "#1F4E99"],
  ["navy", "#1F2A44"],
  ["purple", "#6C3483"],
  ["pink", "#E8A0B4"],
];

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const r = (r1 + r2) / 2;
  return Math.sqrt(
    (2 + r / 256) * (r1 - r2) ** 2 +
      4 * (g1 - g2) ** 2 +
      (2 + (255 - r) / 256) * (b1 - b2) ** 2,
  );
}

export function colourWord(hex: string): string {
  let best = NAMED[0];
  for (const named of NAMED) {
    if (distance(hex, named[1]) < distance(hex, best[1])) best = named;
  }
  return best[0];
}

const word = (w: string) => w.toLowerCase().replace(/[^a-z0-9-]/g, "");

// "Matte Black" + "matte powder-coated steel" reads "matte black powder-coated
// steel": the colour name takes the place of the words it repeats at the start
// of the material. Words further on stay, so a sentence keeps its grammar and a
// second part keeps its own colour ("... in a black matte base").
export function colourMaterial(colourName: string, material: string): string {
  const said = new Set(colourName.split(/\s+/).map(word).filter(Boolean));
  const words = material.split(/\s+/).filter(Boolean);
  const lead = words.findIndex((w) => !said.has(word(w)));
  const rest = words.slice(lead === -1 ? words.length : lead).join(" ");
  return `${colourName.toLowerCase()} ${rest}`.trim();
}

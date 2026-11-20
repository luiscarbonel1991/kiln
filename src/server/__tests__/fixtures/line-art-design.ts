// A design project's editor state for the database tests: a fern leaf
// uploaded as the master, and line-art drawings, each with the takes it has.

const field = { value: "x", source: "recipe" as const, locked: false };
const fields = {
  subject: field,
  materials: field,
  scene: field,
  composition: field,
  lighting: field,
  mood: field,
  palette: field,
};

export const lineArtDrawing = (
  i: number,
  direction: string,
  outputs: string[] = [],
) => ({
  id: `recipe-line-art-${i}`,
  parentId: null,
  masterAssetId: "m-1",
  recipeId: "recipe-line-art",
  type: "image" as const,
  direction,
  fields,
  references: [],
  model: {
    provider: "openai" as const,
    model: "gpt-image-2",
    aspect: "1:1",
    guidance: 7.5,
    strength: 0.65,
  },
  outputs,
  status: outputs.length ? ("done" as const) : ("draft" as const),
});

export const lineArtDesign = (
  name: string,
  cards: ReturnType<typeof lineArtDrawing>[],
) => ({
  name,
  phase: "generation" as const,
  master: {
    id: "m-1",
    origin: "upload" as const,
    sourcePrompt: null,
    assetUrl: "https://stub.local/fern.png",
    mime: "image/png",
  },
  understanding: {
    subject: "a fern leaf",
    productType: "",
    useContext: "",
    sceneProps: "",
    avoid: "",
    materials: "ink",
    lighting: "flat",
    composition: "centered",
    mood: "calm",
    palette: ["#000000"],
  },
  recipeId: "recipe-line-art",
  planning: null,
  cards,
});

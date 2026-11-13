import { type ExactView, exactView } from "@/domain/exact";
import { Product } from "@/domain/product";
import type { ExactKind } from "@/domain/shot-list";
import type { PlateImage } from "@/lib/plate-href";
import {
  type StoryProduct,
  type StoryWords,
  storyProduct,
  storyWords,
} from "@/lib/product-story";

// The public page's running example: a kit Kiln made for one sample product,
// an engraved serving board, on 2026-11-13 (a Launch project: Etsy and
// Instagram; GPT Image 2 at medium quality, 2K where the destination asks,
// each take looked over by a text model; the video on Gemini Omni Flash).
// Every take keeps what its check read, and the costs are what Kiln recorded.
// All nine takes passed. The first cherry hero passed too and read as painted
// rather than wood, so it was taken again: the page shows both. Served as
// fixed files (public/home/board); nothing here reaches the server.

// Under the path a static copy of the page is served at (export-site.mjs);
// nothing in an installed Kiln.
const FILES = `${process.env.NEXT_PUBLIC_KILN_BASE ?? ""}/home/board`;

export const KIT_PRODUCT: Product = Product.parse({
  id: "sample:board",
  sku: "SAMPLE-03",
  name: "Engraved family serving board",
  family: "Kitchen",
  description:
    "Hardwood serving board engraved with the family name and the year.",
  dimensions: { w: 16, h: 10, d: 0.75, unit: "in" },
  shape: "serving board",
  material: "solid walnut with an oiled finish",
  treatment: "engraved",
  colours: [
    {
      key: "walnut",
      name: "Walnut",
      face: "#6B4530",
      inlay: "#2A170E",
      edge: "#4E3020",
    },
    {
      key: "maple",
      name: "Maple",
      face: "#E3C9A0",
      inlay: "#6B4A2E",
      edge: "#C9AC80",
    },
    {
      key: "cherry",
      name: "Cherry",
      face: "#A8623F",
      inlay: "#4A2313",
      edge: "#86492C",
    },
    {
      key: "oak",
      name: "Oak",
      face: "#C9A66B",
      inlay: "#5E3D1F",
      edge: "#A98850",
    },
  ],
  defaultColour: "walnut",
  typography: { family: "Fraunces", weight: 400, case: "title" },
  wording: [
    {
      label: "Family name",
      maxChars: 12,
      required: true,
      example: "The Kilns",
    },
    { label: "Year", maxChars: 4, required: false, example: "2026" },
  ],
  useContexts: [
    "a kitchen counter, leaning against the tiled wall",
    "a dinner table with cheese and grapes set beside the engraving",
  ],
  hook: "Your name, engraved to last",
  price: 48,
  source: { kind: "form" },
});

export interface KitTake {
  url: string;
  label: string;
  aspect: "1:1" | "4:5";
  alt: string;
  // What the take's check read, as the board shows it.
  check: string;
  passed: boolean;
  // Where the wording the check read sits (x, y, w, h as fractions).
  read?: [number, number, number, number];
}

export interface KitFrame {
  label: string;
  view: ExactView;
}

export interface KitColour {
  key: string;
  name: string;
  face: string;
  take: KitTake;
}

const PASSED = "Checked · text 2/2 · letters match · looked over";

const take = (
  file: string,
  label: string,
  aspect: KitTake["aspect"],
  alt: string,
  failed?: { check: string; read: KitTake["read"] },
): KitTake => ({
  url: `${FILES}/${file}.jpg`,
  label,
  aspect,
  alt,
  check: failed?.check ?? PASSED,
  passed: !failed,
  ...(failed?.read ? { read: failed.read } : {}),
});

const TAKES = {
  hero: take(
    "hero",
    "Marketplace hero",
    "1:1",
    "A walnut serving board leaning on a stone kitchen wall, engraved The Kilns, 2026",
  ),
  lifestyle: take(
    "lifestyle",
    "Lifestyle scene",
    "4:5",
    "The board on a linen runner on a dinner table, beside grapes, cheese and crackers",
  ),
  gift: take(
    "gift",
    "Packaging / gift",
    "4:5",
    "The board leaning on an open kraft gift box with tissue paper and a brown ribbon",
  ),
  hook: take(
    "hook",
    "Instagram hook",
    "4:5",
    "The board leaning on a tiled kitchen wall between a vase of olive branches and a jar of wooden spoons",
  ),
  inUse: take(
    "inuse",
    "In-use mockup",
    "4:5",
    "The board leaning on a white tiled kitchen wall beside a jar of wooden spoons and a plant",
  ),
  // The cherry hero's first take: it passed its check and read as painted.
  retaken: take(
    "hero-cherry-first",
    "Cherry hero, first take",
    "1:1",
    "The board in a flat orange-brown with almost no grain, more like paint than cherry wood",
  ),
};

const COLOUR_TAKES: Record<string, string> = {
  walnut: "hero",
  maple: "hero-maple",
  cherry: "hero-cherry",
  oak: "hero-oak",
};

const FRAME_LABEL: Partial<Record<ExactKind, string>> = {
  "colour-grid": "Colour options",
  "size-spec": "Size & spec",
  scale: "Scale",
  personalize: "How to personalize",
};

export interface SiteKit {
  product: StoryProduct;
  plate: PlateImage;
  frames: KitFrame[];
  takes: typeof TAKES;
  colours: KitColour[];
  words: StoryWords | null;
  video: { url: string; poster: string; seconds: number; cost: number };
  // The same letter, enlarged: as the spec draws it, and on two takes.
  loupes: { reference: string; passed: string; other: string };
  // What Kiln recorded for the project, in dollars.
  cost: {
    sceneTakes: number;
    scenes: number;
    videos: number;
    video: number;
    total: number;
    // What one hero in another colour cost.
    colourTake: number;
  };
}

export function siteKit(): SiteKit {
  const kinds = Object.keys(FRAME_LABEL) as ExactKind[];
  return {
    product: storyProduct(KIT_PRODUCT),
    // The board's own drawing, which fills its frame edge to edge.
    plate: { href: `${FILES}/face.svg`, box: { x: 0, y: 0, w: 1, h: 1 } },
    frames: kinds.map((kind) => ({
      label: FRAME_LABEL[kind] ?? kind,
      view: exactView(kind, KIT_PRODUCT),
    })),
    takes: TAKES,
    colours: KIT_PRODUCT.colours.map((c) => ({
      key: c.key,
      name: c.name,
      face: c.face,
      take: take(
        COLOUR_TAKES[c.key] ?? "hero",
        `${c.name} hero`,
        "1:1",
        `The board in ${c.name.toLowerCase()}, leaning on a kitchen wall, engraved The Kilns, 2026`,
      ),
    })),
    words: storyWords(KIT_PRODUCT, undefined),
    video: {
      url: `${FILES}/lifestyle.mp4`,
      poster: `${FILES}/video-poster.jpg`,
      seconds: 8,
      cost: 0.83,
    },
    loupes: {
      reference: `${FILES}/loupe-reference.jpg`,
      passed: `${FILES}/loupe-pass.jpg`,
      other: `${FILES}/loupe-gift.jpg`,
    },
    cost: {
      sceneTakes: 9,
      scenes: 0.94,
      videos: 1,
      video: 0.83,
      total: 1.77,
      colourTake: 0.12,
    },
  };
}

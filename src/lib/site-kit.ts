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
// a glazed coaster, on 2026-11-10 (a Launch project: Etsy and Instagram; GPT
// Image 2 at medium quality, 2K where the destination asks; the video on
// Gemini Omni Flash). Every take keeps what its check read, the two that
// failed included, and the costs are what Kiln recorded. The lifestyle scene
// and its video were retaken on 2026-11-11: the first had a wine glass with
// no foot, which the check does not look for. Served as fixed
// files (public/home/coaster); nothing here reaches the server.

// Under the path a static copy of the page is served at (export-site.mjs);
// nothing in an installed Kiln.
const FILES = `${process.env.NEXT_PUBLIC_KILN_BASE ?? ""}/home/coaster`;

export const KIT_PRODUCT: Product = Product.parse({
  id: "sample:coaster",
  sku: "SAMPLE-02",
  name: "Glazed stoneware name coaster",
  family: "Home",
  description: "Round stoneware coaster with the family name inlaid in glaze.",
  dimensions: { w: 4, h: 4, d: 0.4, unit: "in" },
  shape: "round coaster",
  material: "speckled stoneware with a satin glaze",
  treatment: "inlaid",
  colours: [
    {
      key: "terracotta",
      name: "Terracotta",
      face: "#B4532F",
      inlay: "#F6EBD7",
      edge: "#8E3F22",
    },
    {
      key: "cobalt",
      name: "Cobalt",
      face: "#2B4590",
      inlay: "#F6EBD7",
      edge: "#1E3170",
    },
    {
      key: "celadon",
      name: "Celadon",
      face: "#A7C3AE",
      inlay: "#2E4638",
      edge: "#86A590",
    },
    {
      key: "oat",
      name: "Oat",
      face: "#E5D9C1",
      inlay: "#5A3D2B",
      edge: "#C9BB9F",
    },
  ],
  defaultColour: "terracotta",
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
    "a coffee table under a cup of coffee",
    "a set dinner table under a glass of wine",
  ],
  hook: "Your name, glazed to last",
  price: 16,
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

const PASSED = "Checked · text 2/2 · letters match";

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
    "A terracotta stoneware coaster standing on a plain backdrop, lettered The Kilns, 2026, in cream glaze",
  ),
  lifestyle: take(
    "lifestyle",
    "Lifestyle scene",
    "4:5",
    "The coaster on a linen tablecloth beside a stemless glass of white wine, with olives, grapes and cheese",
  ),
  gift: take(
    "gift",
    "Packaging / gift",
    "4:5",
    "The coaster leaning on a kraft gift box tied with a cream ribbon",
  ),
  hook: take(
    "hook",
    "Instagram hook",
    "4:5",
    "The coaster on a stone table in morning light, beside a mug of coffee",
  ),
  failed: take(
    "inuse-fail",
    "In-use mockup",
    "4:5",
    "The coaster under a speckled mug of coffee on a stone side table",
    {
      check:
        '"The Kilns" letters thinner than the reference: stroke 0.09 vs 0.15 of their height',
      read: [0.35, 0.575, 0.4, 0.11],
    },
  ),
};

const COLOUR_TAKES: Record<string, string> = {
  terracotta: "hero",
  cobalt: "hero-cobalt",
  celadon: "hero-celadon",
  oat: "hero-oat",
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
  loupes: { reference: string; passed: string; failed: string };
  // What Kiln recorded for the project, in dollars.
  cost: {
    sceneTakes: number;
    scenes: number;
    videos: number;
    video: number;
    total: number;
  };
}

export function siteKit(): SiteKit {
  const kinds = Object.keys(FRAME_LABEL) as ExactKind[];
  return {
    product: storyProduct(KIT_PRODUCT),
    // The coaster's own drawing, which fills its frame edge to edge.
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
        `The coaster in ${c.name.toLowerCase()} glaze, standing on a plain backdrop`,
      ),
    })),
    words: storyWords(KIT_PRODUCT, undefined),
    video: {
      url: `${FILES}/lifestyle.mp4`,
      poster: TAKES.lifestyle.url,
      seconds: 6,
      cost: 0.61,
    },
    loupes: {
      reference: `${FILES}/loupe-reference.jpg`,
      passed: `${FILES}/loupe-pass.jpg`,
      failed: `${FILES}/loupe-fail.jpg`,
    },
    cost: { sceneTakes: 14, scenes: 1.29, videos: 2, video: 1.23, total: 2.52 },
  };
}

import type { BrandKit } from "@/domain/brand";
import { type ExactView, exactView, TREATMENT_LABEL } from "@/domain/exact";
import { listingDraft } from "@/domain/listing";
import { type PlanDestination, ProjectPlan } from "@/domain/plan";
import { projectProduct } from "@/domain/plan-look";
import { buyerSizeLabel, type Product } from "@/domain/product";
import { productInLook } from "@/domain/product-look";
import { type TakeCheck, takeCheckLabel } from "@/domain/qc";
import type { ExactKind } from "@/domain/shot-list";
import { isRenderableUrl } from "@/lib/asset-url";
import { SAMPLE_PRODUCT } from "@/lib/home-sample";
import { type PlateImage, plateHref } from "@/lib/plate-href";
import { CATALOG } from "@/lib/recipes";

// Home's story (ROADMAP "Toward a stable version", step 3; Luis, 2026-11-02):
// one product traveling through Kiln, told with the maker's own work, the
// sample product where they have none. Pure: the server reads, these build.

export interface StoryProduct {
  name: string;
  sku: string;
  size: string;
  material: string;
  finish: string;
  colours: { key: string; name: string; face: string; inStock: boolean }[];
  wording: { label: string; example?: string }[];
  price?: number;
  hook?: string;
}

export interface StoryFrame {
  view: ExactView;
  aspect: string;
  label: string;
}

export interface StoryScene {
  url: string;
  label: string;
  aspect: string;
  check?: { label: string; status: TakeCheck["status"] };
}

export interface StoryLook {
  key: string;
  name: string;
  face: string;
  view: ExactView;
}

export interface StoryWords {
  channel: string;
  title: string;
  titleMax: number;
  description: string;
  tags: string[];
  tagMax: number;
}

export interface StoryDestination {
  id: string;
  name: string;
  aspects: string[];
  // This project delivers there.
  used: boolean;
  // Kiln made a draft there from this project.
  drafted: boolean;
}

export interface StoryDesign {
  name: string;
  source?: string;
  lineArt: string;
  vector: string;
}

export interface HomeStory {
  // Where the story comes from: the maker's project, or the sample.
  project: { id: string; name: string } | null;
  product: StoryProduct;
  plate: PlateImage | null;
  exact: StoryFrame[];
  // Empty: the scenes chapter shows where the maker's will appear.
  scenes: StoryScene[];
  looks: StoryLook[];
  words: StoryWords | null;
  destinations: StoryDestination[];
  // Null: the sample design.
  design: StoryDesign | null;
}

export const MAX_EXACT = 3;
export const MAX_SCENES = 4;
export const MAX_LOOKS = 5;

const STORY_KINDS: readonly ExactKind[] = [
  "colour-grid",
  "size-spec",
  "scale",
  "personalize",
];

const destinationOf = (id: string) =>
  CATALOG.destinations.find((d) => d.id === id);

// The project Home tells its story with: the one whose sale destination has
// the most approved scenes, else the most recently changed one with a plan.
// `rows` come newest first.
export function pickShowcase(
  rows: { id: string; plan: unknown }[],
): string | null {
  let best: { id: string; score: number } | null = null;
  let first: string | null = null;
  for (const row of rows) {
    const plan = ProjectPlan.safeParse(row.plan);
    if (!plan.success) continue;
    first ??= row.id;
    const score = plan.data.destinations
      .filter((d) => destinationOf(d.destinationId)?.kind === "sale")
      .flatMap((d) => d.slots)
      .filter((s) => !s.off && s.fill === "scene" && s.approvedOutput).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { id: row.id, score };
    }
  }
  return best?.id ?? first;
}

export function storyProduct(product: Product): StoryProduct {
  return {
    name: product.name,
    sku: product.sku,
    size: buyerSizeLabel(product),
    material: product.material,
    finish: TREATMENT_LABEL[product.treatment],
    colours: product.colours.map((c) => ({
      key: c.key,
      name: c.name,
      face: c.face,
      inStock: c.inStock,
    })),
    wording: product.wording.map((w) => ({
      label: w.label,
      ...(w.example ? { example: w.example } : {}),
    })),
    ...(product.price !== undefined ? { price: product.price } : {}),
    ...(product.hook ? { hook: product.hook } : {}),
  };
}

// The exact frames the story deals: the destination's own, else the kinds
// the product supports.
function storyExact(
  shown: Product,
  destination: PlanDestination | undefined,
  brand: BrandKit | null,
): StoryFrame[] {
  const planned = (destination?.slots ?? []).filter(
    (s) =>
      !s.off && s.fill === "exact" && s.exact && STORY_KINDS.includes(s.exact),
  );
  const slots =
    planned.length > 0
      ? planned.map((s) => ({
          kind: s.exact as ExactKind,
          aspect: s.aspect ?? "1:1",
          label: s.label,
          template: s.textTemplate,
        }))
      : STORY_KINDS.filter(
          (k) =>
            (k !== "colour-grid" || shown.colours.length > 1) &&
            (k !== "personalize" || shown.wording.length > 0),
        ).map((kind) => ({
          kind,
          aspect: "1:1",
          label: EXACT_LABEL[kind],
          template: undefined,
        }));
  return slots.slice(0, MAX_EXACT).map((s) => ({
    view: exactView(s.kind, shown, s.template, brand),
    aspect: s.aspect,
    label: s.label,
  }));
}

const EXACT_LABEL: Record<ExactKind, string> = {
  "colour-grid": "Colour options",
  "size-spec": "Size & spec",
  scale: "Scale",
  personalize: "How to personalize",
  "text-card": "Text card",
};

// The product in each of its colours, drawn to its size.
function storyLooks(product: Product): StoryLook[] {
  return product.colours.slice(0, MAX_LOOKS).map((c) => ({
    key: c.key,
    name: c.name,
    face: c.face,
    view: exactView(
      "size-spec",
      productInLook(product, { colour: c.key, style: null }),
    ),
  }));
}

function storyWords(
  product: Product,
  destination: PlanDestination | undefined,
): StoryWords | null {
  const profile =
    (destination && destinationOf(destination.destinationId)?.text
      ? destinationOf(destination.destinationId)
      : undefined) ?? CATALOG.destinations.find((d) => d.text);
  if (!profile?.text) return null;
  const listing =
    (destination?.destinationId === profile.id
      ? destination.listing
      : undefined) ?? listingDraft(product, profile.text);
  const description = listing.description.value
    .split(/\n\s*\n/)
    .slice(0, 2)
    .join("\n\n")
    .trim();
  return {
    channel: profile.name,
    title: listing.title.value.trim(),
    titleMax: profile.text.title.maxChars,
    description,
    tags: listing.tags.value,
    tagMax: profile.text.tags.count,
  };
}

function storyDestinations(
  plan: ProjectPlan | null,
  drafted: string[],
): StoryDestination[] {
  const used = new Set(plan?.destinations.map((d) => d.destinationId) ?? []);
  return CATALOG.destinations.map((d) => ({
    id: d.id,
    name: d.name,
    aspects: [...new Set(d.formats.map((f) => f.aspect))],
    used: used.has(d.id),
    drafted: drafted.includes(d.id),
  }));
}

// The approved scenes of every destination, each once, with its check.
function storyScenes(
  plan: ProjectPlan,
  checks: Map<string, TakeCheck | null>,
): StoryScene[] {
  const seen = new Set<string>();
  const scenes: StoryScene[] = [];
  for (const destination of plan.destinations) {
    for (const slot of destination.slots) {
      const url = slot.approvedOutput;
      if (slot.off || slot.fill !== "scene" || !url) continue;
      if (!isRenderableUrl(url) || seen.has(url)) continue;
      seen.add(url);
      const check = checks.get(url);
      scenes.push({
        url,
        label: slot.label,
        aspect: slot.aspect ?? "1:1",
        ...(check
          ? { check: { label: takeCheckLabel(check), status: check.status } }
          : {}),
      });
    }
  }
  return scenes.slice(0, MAX_SCENES);
}

// The story of a maker's project.
export function projectStory(input: {
  project: { id: string; name: string };
  product: Product;
  plan: ProjectPlan;
  brand: BrandKit | null;
  checks: Map<string, TakeCheck | null>;
  drafted: string[];
  design: StoryDesign | null;
}): HomeStory {
  const shown = projectProduct(input.product, input.plan);
  const sale =
    input.plan.destinations.find(
      (d) => destinationOf(d.destinationId)?.kind === "sale",
    ) ?? input.plan.destinations[0];
  return {
    project: input.project,
    product: storyProduct(shown),
    plate: plateHref(shown),
    exact: storyExact(shown, sale, input.brand),
    scenes: storyScenes(input.plan, input.checks),
    looks: storyLooks(input.product),
    words: storyWords(input.product, sale),
    destinations: storyDestinations(input.plan, input.drafted),
    design: input.design,
  };
}

// The story told with the sample product (a first visit, or no database).
export function sampleStory(design: StoryDesign | null = null): HomeStory {
  return {
    project: null,
    product: storyProduct(SAMPLE_PRODUCT),
    plate: null,
    exact: storyExact(SAMPLE_PRODUCT, undefined, null),
    scenes: [],
    looks: storyLooks(SAMPLE_PRODUCT),
    words: storyWords(SAMPLE_PRODUCT, undefined),
    destinations: storyDestinations(null, []),
    design,
  };
}

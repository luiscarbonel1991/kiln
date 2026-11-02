import { z } from "zod";
import type { BrandProfile } from "@/domain/brand";
import type { DestinationText } from "@/domain/destination";
import { TREATMENT_LABEL } from "@/domain/exact";
import { type ListingText, listingVariations } from "@/domain/listing";
import {
  buyerSizeLabel,
  dimensionsLabel,
  type Product,
  partLabel,
  Treatment,
} from "@/domain/product";
import type { ListingSlot } from "@/domain/recipe";
import type { BaseUnderstanding } from "@/domain/understanding";
import { VariantDirection } from "@/domain/variant-direction";

// What vision and the art director ask, whichever provider answers: one prompt
// and one answer shape, so switching the text model never changes the
// question. The answers have no defaults (structured outputs require every
// field); BaseUnderstanding adds its own.

export const VISION_PROMPT = [
  "Analyze this single product image for a brand content studio that will place the EXACT product into new scenes. Return JSON:",
  "- subject: the product in a short phrase.",
  "- productType: a concrete product-category noun, e.g. 'coffee mug', 'scented candle', 'wall print', 'ceramic planter'.",
  "- useContext: where this product actually lives / is used / installed / displayed in real life — one short phrase, e.g. 'held at a kitchen counter', 'on a bedside table', 'hung on a living-room wall', 'on a sunny windowsill'. Infer from the product type, not just this photo.",
  "- sceneProps: name, as a short NOUN phrase, anything visible in THIS photo that is a prop, mount, hand, stand or surface and is NOT part of the product itself, e.g. 'a wooden display stand', 'a hand', 'a hook'. Use an empty string if the product is shown alone on a plain background.",
  "- materials, lighting, composition, mood: each a short phrase.",
  "- palette: 3-6 dominant colors as hex strings like #aabbcc.",
].join("\n");

export const VisionAnswer = z.object({
  subject: z.string(),
  productType: z.string(),
  useContext: z.string(),
  sceneProps: z.string(),
  materials: z.string(),
  lighting: z.string(),
  composition: z.string(),
  mood: z.string(),
  palette: z.array(z.string()),
});

export const DirectionsAnswer = z.object({
  variants: z.array(VariantDirection),
});

export function artDirectionPrompt(
  understanding: BaseUnderstanding,
  brand: BrandProfile,
  slots: ListingSlot[],
): string {
  const slotLines = slots
    .map((s, i) => `${i + 1}. ${s.label} — goal: ${s.purpose}`)
    .join("\n");
  return `You are an e-commerce product photographer and conversion designer planning a buyer-ready Etsy/marketplace LISTING SET from a single product photo. Each shot is a LISTING SLOT with a specific commercial job — design it to do that job, not just to look nice.

PRODUCT (keep it identical in every shot — same shape, label, finish, color):
- Subject: ${understanding.subject}
- Product type: ${understanding.productType || understanding.subject}
- Where it is actually used: ${understanding.useContext || "infer from the product type"}
- Materials: ${understanding.materials}
- Mood: ${understanding.mood}

BRAND "${brand.name}" — tone: ${brand.tone.join(", ")}; visual style: ${brand.visualStyle.join(", ")}.
HARD CONSTRAINTS — never violate: ${brand.dontList.join("; ")}. No text, labels, callouts, arrows, rulers-with-numbers, or graphic overlays in ANY shot (these are real photographs).

First, REASON from "Where it is actually used" above: that is the truth for the contextual slots. What real surfaces, walls, doors, rooms, hands, or companion objects belong with THIS product? What everyday object conveys its true size? A product that hangs (a wall print, a mirror, an ornament) belongs on its wall or hook — NOT on a desk or table. Do not default to a desk, a tabletop, or a studio sweep for the contextual slots.

Plan ${slots.length} DISTINCT photorealistic shots, ONE PER SLOT below, each serving its goal:
${slotLines}

For EACH slot return:
- scene: WHERE the product sits and the concrete environment + props that serve this slot's goal (be specific and real).
- composition: camera framing/angle/crop that sells this slot.
- lighting: the light setup.

Slot rules:
- "Marketplace hero": clean seamless near-white or soft neutral studio background, soft natural contact shadow, NO props, product centered and filling ~80% of frame — optimized to win the click as a thumbnail.
- "In-use mockup": place the product EXACTLY at its "Where it is actually used" location (a mug held in-hand on a kitchen counter; a print hung on a living-room wall; a candle lit on a bedside table; a planter on a sunny windowsill). Show its function in real context. The product stays the unmistakable hero, sharp and well-lit.
- "Scale & size": the scene MUST include a clear size reference — the product held in a human hand, OR placed directly beside a common everyday object of known size (a coffee mug, a paperback book, a coin). This size cue is MANDATORY; a plain or flat-lay shot with NO size reference does NOT satisfy this slot. No rulers or measurement text.
- "Lifestyle scene": style the product into an aspirational, lived-in real-world setting that matches how it is used — a hung product on a styled wall, a tabletop product on a set table or shelf, a worn product on a person — selling the feeling and brand world, broader and more atmospheric than the functional in-use shot. Match the setting to "Where it is actually used", never a generic desk.
- "Material detail": extreme macro on texture, finish, glaze, grain, seams, or edges that prove craftsmanship and justify the price.
- "Packaging / gift": show the product gift-ready — with its packaging, wrap, ribbon, or a branded insert/card — to invite gift purchases.
- "Alternate angle": the same product from a different angle (back, side, three-quarter) on the same clean background so nothing is hidden.
- Any other slot: fulfill its stated goal literally.

Make the shots genuinely different from one another — different places, framings, and light — not one scene reworded. Every scene must be a believable PHOTOGRAPH, with the same physical product.`;
}

// Pin each answer to its slot label, in order; a short answer is filled from
// the recipe's own directions (`fill`).
export function pinToSlots(
  variants: VariantDirection[],
  slots: ListingSlot[],
  fill: VariantDirection[],
): VariantDirection[] {
  return slots.map((slot, i) =>
    variants[i] ? { ...variants[i], direction: slot.label } : fill[i],
  );
}

// A product drafted from one photo (the product form's "Fill from the photo"):
// what a maker would type, read from the picture. Never its size — a photo has
// no scale — and never saved without the maker's review.
export const PRODUCT_DRAFT_PROMPT = [
  "This photo shows one physical product a small maker sells. Describe it for the maker's product form. Return JSON:",
  "- name: a short product name a shop would list it under, e.g. 'Engraved walnut cutting board'.",
  "- whatItIs: a short noun phrase for the object itself, e.g. 'cutting board', 'round coaster', 'wall print'.",
  "- material: what it is made of, as a buyer would say it, e.g. 'solid walnut', 'glazed stoneware'.",
  "- treatment: how its marks or design are made — engraved (cut into the surface), raised (standing out from the face), inlaid (filled with a second material or colour), printed (flat print or paint), cut (the shape itself is cut through), reveal (a top layer cut through to show a base of another colour beneath), or letters (each letter or digit a separate cut-out piece, with no backing plate).",
  "- colours: the finish colours of the product itself (not the background), 1-4, each with a plain name and a hex like #5B3A29.",
  "- wording: any text on the product a buyer would personalize (a name, a date), at most 3 lines, each with a short label and the example shown; an empty list if there is none.",
  "- useContext: where it is used in real life, one short phrase, e.g. 'a kitchen counter'.",
].join("\n");

export const ProductDraft = z.object({
  name: z.string(),
  whatItIs: z.string(),
  material: z.string(),
  treatment: Treatment,
  colours: z.array(z.object({ name: z.string(), hex: z.string() })),
  wording: z.array(z.object({ label: z.string(), example: z.string() })),
  useContext: z.string(),
});
export type ProductDraft = z.infer<typeof ProductDraft>;

// A listing's prose (the board's "Write it with the text model"): the title,
// description, tags and materials, from the maker's spec alone, within the
// channel's rules. The free draft from the spec goes along, to improve on;
// Kiln checks the answer against the rules (nothing is cut on its own).
export function listingCopyPrompt(input: {
  channel: string;
  product: Product;
  rules: DestinationText;
  draft: ListingText;
}): string {
  const { channel, product, rules, draft } = input;
  const facts = {
    name: product.name,
    whatItIs: product.shape,
    family: product.family,
    material: product.material,
    finish: TREATMENT_LABEL[product.treatment],
    size: buyerSizeLabel(product),
    ...(product.parts
      ? {
          overallSize: dimensionsLabel(product.dimensions),
          parts: product.parts.map((p) => ({
            name: p.name,
            size: partLabel(p, product.dimensions.unit),
            ...(p.colour ? { colour: p.colour.name } : {}),
            ...(p.material ? { material: p.material } : {}),
          })),
        }
      : {}),
    colours: product.colours.map((c) =>
      c.inStock ? c.name : `${c.name} (out of stock)`,
    ),
    textTheBuyerTypes: product.wording.map((w) => ({
      label: w.label,
      required: w.required,
      ...(w.maxChars ? { maxCharacters: w.maxChars } : {}),
    })),
    variations: listingVariations(product).map((v) => ({
      name: v.name,
      values: v.values.map((x) => x.label),
    })),
    placesOfUse: product.useContexts,
    ...(product.hook ? { hook: product.hook } : {}),
    ...(product.description ? { description: product.description } : {}),
  };
  return [
    `Write the text of one product listing for ${channel}. A small maker pastes it into ${channel}'s listing editor; a human publishes it. Return JSON.`,
    "The product, from the maker's spec. These are the only facts you may use: invent no feature, material, size, claim, price, shipping, or production detail the spec does not give.",
    JSON.stringify(facts, null, 2),
    "Rules:",
    `- title: at most ${rules.title.maxChars} characters${rules.title.adviseMaxWords ? ` and about ${rules.title.adviseMaxWords} words or fewer` : ""}. Name the item once, leading with its colour, material and size where they matter; no word twice; no lists of keywords.`,
    "- description: plain text, no markdown, no emoji. Open with one line on what it is and who it is for. Then short sections headed in capitals (e.g. WHAT YOU GET, PERSONALIZATION): the size, material, finish and colours; each line the buyer types and its limit. Nothing about price, shipping, returns or how it is made beyond the spec.",
    `- tags: exactly ${rules.tags.count} tags, each at most ${rules.tags.maxChars} characters, only letters, numbers, spaces, hyphens and apostrophes. Whole phrases a buyer would search; no two alike; not a lone word already in the title. Mix broad terms, longer specific phrases, and the buyer's own words (who it is for, the occasion, the room).`,
    "- materials: 1-5 materials, each a few words, as a buyer would say them.",
    "A free draft written from the spec, to improve on:",
    JSON.stringify(
      {
        title: draft.title.value,
        description: draft.description.value,
        tags: draft.tags.value,
        materials: draft.materials.value,
      },
      null,
      2,
    ),
    "Write in English.",
  ].join("\n");
}

export const ListingCopy = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  materials: z.array(z.string()),
});
export type ListingCopy = z.infer<typeof ListingCopy>;

// One field of the product form as the review reads it: its path
// ("wording.0.label"), what the maker typed ("" when empty), its limit or its
// options, and whether it only takes a check (a size is the maker's to
// measure).
export interface ReviewField {
  field: string;
  value: string;
  maxChars?: number;
  options?: string[];
  checkOnly?: boolean;
}

// What each field is for, so the model judges it by what reads it.
const FIELD_USE: [RegExp, string][] = [
  [
    /^name$/,
    "the name a shop lists it under; it titles the listing and the frames",
  ],
  [
    /^whatItIs$/,
    "the object itself in a short noun phrase, like 'round coaster'; every image prompt and Size & spec name it",
  ],
  [
    /^size$/,
    "the size as typed, in both units and beside an everyday object; only the maker can measure it",
  ],
  [
    /^material$/,
    "what it is made of, as a buyer says it; the image prompts, Size & spec and the listing's materials read it",
  ],
  [/^treatment$/, "how its marks are made; the close-up scenes show it"],
  [
    /^colours\.\d+\.name$/,
    "a finish colour's name, as a buyer picks it; Colour options and the listing's variations show it",
  ],
  [
    /^wording\.\d+\.label$/,
    "what the buyer is asked to write, a short label like 'Name' or 'Date'; How to personalize and the listing ask it",
  ],
  [
    /^wording\.\d+\.example$/,
    "the example the frames show for that line, like 'Sofia'; real buyer text that fits the line's most characters",
  ],
  [
    /^wording\.\d+\.maxChars$/,
    "the most characters the buyer may type in that line, a whole number; empty means the text is fitted to the piece",
  ],
  [
    /^useContexts\.\d+$/,
    "a place where it is used, the most typical first, a short phrase like 'a kitchen counter'; the in-use and lifestyle scenes take place there",
  ],
  [/^hook$/, "the first line of a carousel"],
  [/^cta$/, "the call to action at the end of a carousel"],
  [
    /^description$/,
    "the maker's own description; the listing reads it for what the other fields do not say",
  ],
];

const fieldUse = (field: string) =>
  FIELD_USE.find(([re]) => re.test(field))?.[1] ?? "";

// The product form's review (the form's "Review with AI"): suggestions the
// maker accepts one by one, and checks only the maker can settle. From the
// form alone: never a size, a price or a feature it does not give.
export function productReviewPrompt(fields: ReviewField[]): string {
  const listed = fields.map((f) => ({
    field: f.field,
    value: f.value,
    use: fieldUse(f.field),
    ...(f.maxChars ? { maxCharacters: f.maxChars } : {}),
    ...(f.options ? { options: f.options } : {}),
    ...(f.checkOnly ? { checkOnly: true } : {}),
  }));
  return [
    "Review a small maker's product form before they save it. Kiln turns the form into exact frames (Size & spec, How to personalize, Colour options), image prompts and a listing, so each field is read by an image model and by a buyer. Return JSON.",
    "The form, one entry per field: its path, what the maker typed ('' when empty), what reads it, and its limit or options:",
    JSON.stringify(listed, null, 2),
    "Rules:",
    "- suggestions: only where a change makes a real difference to the frames, the scenes or the listing, for example: an empty field the product needs; the example typed where the label belongs; a vague material; a colour name a buyer would not choose by; an example longer than its line. Each has field (a path from the list), value (the whole new value, within its limit; one of the options where a field has them; digits for maxChars) and why (one short sentence to the maker on what it changes).",
    "- Use only what the form says. Invent no feature, material, size, price or claim. Keep the maker's words where they work, and never suggest the value a field already has.",
    "- Never suggest a size or a price. A field marked checkOnly takes a check, never a suggestion.",
    "- checks: what only the maker can confirm, for example a size that reads wrong beside its everyday object, or a material that could mean two things. Each has field and why (one short sentence).",
    "- At most 8 suggestions and 4 checks; empty lists when the form is right. Write in English.",
  ].join("\n");
}

export const ProductReview = z.object({
  suggestions: z.array(
    z.object({ field: z.string(), value: z.string(), why: z.string() }),
  ),
  checks: z.array(z.object({ field: z.string(), why: z.string() })),
});
export type ProductReview = z.infer<typeof ProductReview>;

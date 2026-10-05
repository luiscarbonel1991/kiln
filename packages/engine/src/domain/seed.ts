import { BrandProfile } from "@/domain/brand";
import { DestinationProfile } from "@/domain/destination";
import { composePreset, type Recipe, RecipePreset } from "@/domain/recipe";
import { ShotList } from "@/domain/shot-list";

// Parsed at module load: a malformed seed throws on first import (fail-fast).
export const SEED_BRAND = BrandProfile.parse({
  id: "brand-clay-collective",
  name: "Clay Collective",
  palette: ["#c0461f", "#e8a13a", "#3a5a40", "#efe6d6", "#26221b"],
  fonts: { display: "Fraunces", body: "Hanken Grotesk" },
  tone: ["warm", "handmade", "editorial", "unhurried"],
  visualStyle: [
    "soft directional daylight",
    "natural linen and raw oak surfaces",
    "matte ceramic textures",
    "generous negative space",
  ],
  doList: [
    "keep the product the hero",
    "favor tactile, earthy materials",
    "let highlights stay soft",
  ],
  dontList: [
    "no harsh studio flash",
    "no synthetic or neon colors",
    "no text overlays or watermarks",
  ],
  references: [],
});

// Destination profiles (data, not code). Etsy and Amazon forbid model-drawn text
// on their photos; Instagram allows template text. Formats are the pixel
// targets the delivery step will check.
export const SEED_DESTINATIONS: DestinationProfile[] = [
  {
    id: "etsy",
    name: "Etsy",
    kind: "sale",
    formats: [
      { key: "square", label: "Square photo", aspect: "1:1", minPx: 2000 },
      { key: "portrait", label: "Portrait photo", aspect: "4:5", minPx: 2000 },
    ],
    rules: {
      textOnImage: "forbidden",
      negative: ["text overlay", "watermark"],
    },
    delivery: { mode: "draft-api" },
  },
  {
    id: "amazon",
    name: "Amazon",
    kind: "sale",
    formats: [{ key: "main", label: "Main image", aspect: "1:1", minPx: 1600 }],
    rules: {
      textOnImage: "forbidden",
      negative: ["text overlay", "watermark", "props in hero"],
    },
    delivery: { mode: "export" },
  },
  {
    id: "instagram",
    name: "Instagram",
    kind: "content",
    formats: [
      { key: "feed", label: "Feed post", aspect: "4:5", minPx: 1080 },
      { key: "square", label: "Square post", aspect: "1:1", minPx: 1080 },
      { key: "story", label: "Story", aspect: "9:16", minPx: 1080 },
    ],
    rules: { textOnImage: "allowed", negative: [] },
    delivery: { mode: "export" },
  },
].map((d) => DestinationProfile.parse(d));

// Shot lists. Each slot is a buyer-decision job (not a photo style); the purpose
// drives the ArtDirector and is shown to the user.
export const SEED_SHOT_LISTS: ShotList[] = [
  // Warm, gift-forward Etsy listing.
  {
    id: "etsy-listing",
    name: "Etsy listing",
    destinationId: "etsy",
    projectTypes: ["listing-kit", "launch"],
    fieldDefaults: {
      scene: "soft neutral sweep",
      composition: "centered top-down",
    },
    preserve: ["product shape", "label"],
    slots: [
      {
        key: "hero",
        label: "Marketplace hero",
        purpose:
          "Win the click: clean seamless background, soft contact shadow, no props.",
        aspect: "1:1",
      },
      {
        key: "in-use",
        label: "In-use mockup",
        purpose:
          "Show it where the customer actually uses it, product still the hero.",
        aspect: "4:5",
      },
      {
        key: "colours",
        label: "Colour options",
        purpose:
          "Every colour side by side, named, so the buyer picks without asking.",
        aspect: "1:1",
        fill: "exact",
        exact: "colour-grid",
      },
      {
        key: "size",
        label: "Size & spec",
        purpose:
          "The real dimensions, material and finish, drawn to scale from the spec.",
        aspect: "1:1",
        fill: "exact",
        exact: "size-spec",
      },
      {
        key: "personalize",
        label: "How to personalize",
        purpose:
          "What the buyer types and how much fits, before they message the shop.",
        aspect: "1:1",
        fill: "exact",
        exact: "personalize",
      },
      {
        key: "scale",
        label: "Scale & size",
        purpose:
          "Give a believable size cue so buyers know exactly what they get.",
        aspect: "1:1",
      },
      {
        key: "lifestyle",
        label: "Lifestyle scene",
        purpose:
          "Place it in an aspirational styled setting that sells the feeling.",
        aspect: "4:5",
      },
      {
        key: "detail",
        label: "Material detail",
        purpose:
          "Macro on texture and finish to prove craft and justify the price.",
        aspect: "4:5",
      },
      {
        key: "gift",
        label: "Packaging / gift",
        purpose: "Show it gift-ready to trigger Etsy gift-buying.",
        aspect: "4:5",
      },
    ],
  },
  // Clean, multi-angle, marketplace-leaning (Amazon / Shopify).
  {
    id: "marketplace-stack",
    name: "Marketplace stack",
    destinationId: "amazon",
    fieldDefaults: {
      scene: "clean seamless studio sweep",
      composition: "centered, eye-level",
    },
    preserve: ["product shape", "label"],
    slots: [
      {
        key: "hero",
        label: "Marketplace hero",
        purpose: "Pure clean hero that wins the search-grid click.",
        aspect: "1:1",
      },
      {
        key: "alternate",
        label: "Alternate angle",
        purpose: "Show the back/side so nothing is hidden.",
        aspect: "1:1",
      },
      {
        key: "scale",
        label: "Scale & size",
        purpose: "Anchor true size against a familiar object.",
        aspect: "1:1",
      },
      {
        key: "in-use",
        label: "In-use mockup",
        purpose: "The product working in its real-use context.",
        aspect: "4:5",
      },
      {
        key: "detail",
        label: "Material detail",
        purpose: "Close-up proof of quality and finish.",
        aspect: "4:5",
      },
      {
        key: "lifestyle",
        label: "Lifestyle scene",
        purpose: "Aspirational context that builds desire.",
        aspect: "4:5",
      },
    ],
  },
  // Social funnel stages (a different, valid taxonomy from the listing slots).
  {
    id: "social-launch",
    name: "Social launch",
    destinationId: "instagram",
    fieldDefaults: {
      scene: "gradient brand backdrop",
      composition: "centered hero",
    },
    preserve: ["product shape"],
    negative: ["clutter", "busy background"],
    slots: [
      {
        key: "hook",
        label: "Hook frame",
        purpose: "Stop the scroll in the first second.",
      },
      {
        key: "benefit",
        label: "Benefit",
        purpose: "Show the one reason to want it.",
      },
      {
        key: "proof",
        label: "Social proof",
        purpose: "Make it feel loved and trusted.",
      },
      {
        key: "cta",
        label: "Call to action",
        purpose: "Point clearly to the next step.",
      },
    ],
  },
  // An Instagram carousel is a sequence, not loose images (ROADMAP "Domain
  // model"): hook -> product in place -> detail -> colours -> how to
  // personalize -> call to action, one style across slides. Text is drawn by
  // templates, never by the image model.
  {
    id: "instagram-carousel",
    name: "Instagram carousel",
    destinationId: "instagram",
    projectTypes: ["content", "launch"],
    fieldDefaults: {
      scene: "a warm, softly lit interior that suits the product",
      composition: "the product centered with clean space for a short headline",
    },
    preserve: ["product shape", "label"],
    negative: ["clutter", "busy background"],
    slots: [
      {
        key: "hook",
        label: "Hook",
        purpose:
          "Stop the scroll in the first second; the headline sits on it.",
        aspect: "4:5",
        textTemplate: "{product.hook}",
      },
      {
        key: "in-place",
        label: "Product in place",
        purpose: "Show it where it lives, product still the hero.",
        aspect: "4:5",
      },
      {
        key: "detail",
        label: "Detail",
        purpose: "A close look at the finish that proves the craft.",
        aspect: "4:5",
      },
      {
        key: "colours",
        label: "Colours",
        purpose: "Every colour on one slide.",
        aspect: "4:5",
        fill: "exact",
        exact: "colour-grid",
      },
      {
        key: "personalize",
        label: "How to personalize",
        purpose: "What the buyer chooses, in one glance.",
        aspect: "4:5",
        fill: "exact",
        exact: "personalize",
      },
      {
        key: "cta",
        label: "Call to action",
        purpose: "Point to the shop.",
        aspect: "4:5",
        fill: "exact",
        exact: "text-card",
        textTemplate: "{product.cta}",
      },
    ],
  },
  // Paid social/ads creative set — scroll-stop + single focus + copy-space,
  // distinct from the organic "Social launch" funnel. Not a destination yet.
  {
    id: "paid-ads",
    name: "Paid ads",
    destinationId: null,
    fieldDefaults: {
      scene: "bold brand-color backdrop",
      composition: "single hero focus with generous copy space",
    },
    preserve: ["product shape", "label"],
    negative: ["text overlay", "watermark", "busy clutter"],
    slots: [
      {
        key: "scroll-stopper",
        label: "Scroll-stopper",
        purpose:
          "Stop the thumb in the first second: one bold focal point, high contrast, strong brand backdrop.",
        aspect: "9:16",
      },
      {
        key: "ugc-hook",
        label: "UGC hook",
        purpose:
          "Authentic phone-shot feel — in-hand or casual — the native look that wins paid social.",
        aspect: "4:5",
      },
      {
        key: "benefit",
        label: "Benefit in action",
        purpose:
          "Show the product solving the pain, instantly legible with the sound off.",
        aspect: "1:1",
      },
      {
        key: "offer",
        label: "Offer / copy space",
        purpose:
          "Product to one side, the other half clean for the headline and price.",
        aspect: "1:1",
      },
      {
        key: "vertical-demo",
        label: "Vertical demo",
        purpose: "A quick 'what it's for', framed for Reels and Stories.",
        aspect: "9:16",
      },
    ],
  },
].map((l) => ShotList.parse(l));

// The editor's recipe presets. Ids are the recipe ids saved on cards and
// projects, so they never change; targets are the Planning chip text.
export const SEED_RECIPE_PRESETS: RecipePreset[] = [
  {
    id: "recipe-etsy-hero",
    name: "Etsy listing",
    shotListId: "etsy-listing",
    destinationId: "etsy",
    targets: [
      { name: "Etsy", aspect: "1:1" },
      { name: "Pinterest", aspect: "2:3" },
    ],
  },
  {
    id: "recipe-marketplace",
    name: "Marketplace stack",
    shotListId: "marketplace-stack",
    destinationId: "amazon",
    targets: [
      { name: "Amazon", aspect: "1:1" },
      { name: "Shopify", aspect: "4:5" },
    ],
  },
  {
    id: "recipe-social-launch",
    name: "Social launch",
    shotListId: "social-launch",
    destinationId: "instagram",
    targets: [
      { name: "Stories", aspect: "9:16" },
      { name: "Feed", aspect: "1:1" },
    ],
  },
  {
    id: "recipe-ads",
    name: "Paid ads",
    shotListId: "paid-ads",
    destinationId: null,
    targets: [
      { name: "Meta feed", aspect: "1:1" },
      { name: "Reels / Stories", aspect: "9:16" },
    ],
  },
].map((p) => RecipePreset.parse(p));

const catalog = {
  shotLists: SEED_SHOT_LISTS,
  destinations: SEED_DESTINATIONS,
};
const preset = (id: string): Recipe => {
  const found = SEED_RECIPE_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown recipe preset "${id}"`);
  return composePreset(found, catalog);
};

export const SEED_RECIPE = preset("recipe-etsy-hero"); // id kept stable so saved projects keep resolving
export const SEED_RECIPE_MARKETPLACE = preset("recipe-marketplace");
export const SEED_RECIPE_SOCIAL = preset("recipe-social-launch");
export const SEED_RECIPE_ADS = preset("recipe-ads");

// The app's line-art recipe lives in the APP, not here — src/lib/recipes.ts.
// The OSS engine ships the line-art STYLE capability (recipe `style` + the
// assemblePrompt branch), not any maker's treatments.

// Selector source for Planning. SEED_RECIPE stays the default (index 0).
export const SEED_RECIPES: Recipe[] = [
  SEED_RECIPE,
  SEED_RECIPE_MARKETPLACE,
  SEED_RECIPE_SOCIAL,
  SEED_RECIPE_ADS,
];

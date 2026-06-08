import { BrandProfile } from "@/domain/brand";
import { Recipe } from "@/domain/recipe";

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

// Each direction is a LISTING SLOT — a buyer-decision job (not a photo style). The
// purpose drives the ArtDirector and is shown to the user. Warm, gift-forward.
export const SEED_RECIPE = Recipe.parse({
  id: "recipe-etsy-hero", // id kept stable so saved workspaces keep resolving
  name: "Etsy listing",
  directions: [
    {
      label: "Marketplace hero",
      purpose:
        "Win the click: clean seamless background, soft contact shadow, no props.",
      aspect: "1:1",
    },
    {
      label: "In-use mockup",
      purpose:
        "Show it where the customer actually uses it, product still the hero.",
      aspect: "4:5",
    },
    {
      label: "Scale & size",
      purpose:
        "Give a believable size cue so buyers know exactly what they get.",
      aspect: "1:1",
    },
    {
      label: "Lifestyle scene",
      purpose:
        "Place it in an aspirational styled setting that sells the feeling.",
      aspect: "4:5",
    },
    {
      label: "Material detail",
      purpose:
        "Macro on texture and finish to prove craft and justify the price.",
      aspect: "4:5",
    },
    {
      label: "Packaging / gift",
      purpose: "Show it gift-ready to trigger Etsy gift-buying.",
      aspect: "4:5",
    },
  ],
  fieldDefaults: {
    scene: "soft neutral sweep",
    composition: "centered top-down",
  },
  targets: [
    { name: "Etsy", aspect: "1:1" },
    { name: "Pinterest", aspect: "2:3" },
  ],
  constraints: {
    preserve: ["product shape", "label"],
    negative: ["text overlay", "watermark"],
  },
});

// Clean, multi-angle, marketplace-leaning (Amazon / Shopify).
export const SEED_RECIPE_MARKETPLACE = Recipe.parse({
  id: "recipe-marketplace",
  name: "Marketplace stack",
  directions: [
    {
      label: "Marketplace hero",
      purpose: "Pure clean hero that wins the search-grid click.",
      aspect: "1:1",
    },
    {
      label: "Alternate angle",
      purpose: "Show the back/side so nothing is hidden.",
      aspect: "1:1",
    },
    {
      label: "Scale & size",
      purpose: "Anchor true size against a familiar object.",
      aspect: "1:1",
    },
    {
      label: "In-use mockup",
      purpose: "The product working in its real-use context.",
      aspect: "4:5",
    },
    {
      label: "Material detail",
      purpose: "Close-up proof of quality and finish.",
      aspect: "4:5",
    },
    {
      label: "Lifestyle scene",
      purpose: "Aspirational context that builds desire.",
      aspect: "4:5",
    },
  ],
  fieldDefaults: {
    scene: "clean seamless studio sweep",
    composition: "centered, eye-level",
  },
  targets: [
    { name: "Amazon", aspect: "1:1" },
    { name: "Shopify", aspect: "4:5" },
  ],
  constraints: {
    preserve: ["product shape", "label"],
    negative: ["text overlay", "watermark", "props in hero"],
  },
});

// Social funnel stages (a different, valid taxonomy from the listing slots).
export const SEED_RECIPE_SOCIAL = Recipe.parse({
  id: "recipe-social-launch",
  name: "Social launch",
  directions: [
    { label: "Hook frame", purpose: "Stop the scroll in the first second." },
    { label: "Benefit", purpose: "Show the one reason to want it." },
    { label: "Social proof", purpose: "Make it feel loved and trusted." },
    { label: "Call to action", purpose: "Point clearly to the next step." },
  ],
  fieldDefaults: {
    scene: "gradient brand backdrop",
    composition: "centered hero",
  },
  targets: [
    { name: "Stories", aspect: "9:16" },
    { name: "Feed", aspect: "1:1" },
  ],
  constraints: {
    preserve: ["product shape"],
    negative: ["clutter", "busy background"],
  },
});

// Paid social/ads creative set — scroll-stop + single focus + copy-space, distinct
// from the organic "Social launch" funnel. Feed (1:1) and vertical (9:16) formats.
export const SEED_RECIPE_ADS = Recipe.parse({
  id: "recipe-ads",
  name: "Paid ads",
  directions: [
    {
      label: "Scroll-stopper",
      purpose:
        "Stop the thumb in the first second: one bold focal point, high contrast, strong brand backdrop.",
      aspect: "9:16",
    },
    {
      label: "UGC hook",
      purpose:
        "Authentic phone-shot feel — in-hand or casual — the native look that wins paid social.",
      aspect: "4:5",
    },
    {
      label: "Benefit in action",
      purpose:
        "Show the product solving the pain, instantly legible with the sound off.",
      aspect: "1:1",
    },
    {
      label: "Offer / copy space",
      purpose:
        "Product to one side, the other half clean for the headline and price.",
      aspect: "1:1",
    },
    {
      label: "Vertical demo",
      purpose: "A quick 'what it's for', framed for Reels and Stories.",
      aspect: "9:16",
    },
  ],
  fieldDefaults: {
    scene: "bold brand-color backdrop",
    composition: "single hero focus with generous copy space",
  },
  targets: [
    { name: "Meta feed", aspect: "1:1" },
    { name: "Reels / Stories", aspect: "9:16" },
  ],
  constraints: {
    preserve: ["product shape", "label"],
    negative: ["text overlay", "watermark", "busy clutter"],
  },
});

// Line-art / laser set — black strokes on white (style "line-art"), one motif in
// five laser-ready treatments. Skips the ArtDirector; the slot purpose drives each.
export const SEED_RECIPE_LASER = Recipe.parse({
  id: "recipe-laser-lineart",
  name: "Laser / line",
  style: "line-art",
  directions: [
    {
      label: "Cut outline",
      purpose:
        "A bold single continuous outline of the whole shape — the clean silhouette to cut.",
      aspect: "1:1",
    },
    {
      label: "Engrave detail",
      purpose:
        "Fine interior line work for engraving — decorative detail, no solid fills.",
      aspect: "1:1",
    },
    {
      label: "Framed badge",
      purpose:
        "The motif inside a circular badge frame — coaster or sign ready.",
      aspect: "1:1",
    },
    {
      label: "Geometric",
      purpose:
        "A geometric, straight-line interpretation of the motif — modern and minimal.",
      aspect: "1:1",
    },
    {
      label: "Minimal",
      purpose: "The simplest one- or two-stroke version of the idea.",
      aspect: "1:1",
    },
  ],
  fieldDefaults: {
    scene: "the motif centered with a clean margin",
    composition: "balanced, filling the frame",
    lighting: "flat (line art, no lighting)",
  },
  targets: [{ name: "Laser", aspect: "1:1" }],
  constraints: {
    preserve: ["overall silhouette"],
    negative: [
      "color",
      "gradient",
      "shading",
      "grey",
      "photographic",
      "texture",
      "background scene",
    ],
  },
});

// Selector source for Planning. SEED_RECIPE stays the default (index 0).
export const SEED_RECIPES: Recipe[] = [
  SEED_RECIPE,
  SEED_RECIPE_MARKETPLACE,
  SEED_RECIPE_SOCIAL,
  SEED_RECIPE_ADS,
  SEED_RECIPE_LASER,
];

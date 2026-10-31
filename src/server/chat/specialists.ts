import { z } from "zod";
import type { LessonTopic } from "@/domain/lesson";
import { KNOBS, KnobKey, knobStops, REASONS } from "@/domain/scene-knobs";
import { CATALOG } from "@/lib/recipes";

// Kiln's specialists (ROADMAP "Agents", stage 3): modes of the one agent,
// each its know-how and a subset of the tools, chosen by the maker with a chip
// (Luis, 2026-10-30); the general mode may suggest one. Fewer tools per step
// keep the model on the task and each step cheaper. A specialist becomes an
// agent of its own only if one agent stops coping. The know-how is written
// from Kiln's own data (the knobs, the channel's rules), so it stays true.

export const SpecialistId = z.enum(["kiln", "etsy", "scenes", "svg"]);
export type SpecialistId = z.infer<typeof SpecialistId>;

export interface Specialist {
  id: SpecialistId;
  label: string;
  // What it is for, in a line (the chip's title, the suggestion's button).
  about: string;
  // The tools it may call; null is every chat tool.
  tools: readonly string[] | null;
  // The kept lessons it is told (by topic); null is every topic.
  topics: readonly LessonTopic[] | null;
  instructions: string;
}

const etsy = CATALOG.destinations.find((d) => d.id === "etsy")?.text;

const knobLines = KnobKey.options
  .map((knob) => {
    const stops = KNOBS[knob].stops as Record<
      string,
      { label: string; hint: string }
    >;
    return `  - ${knob} (${KNOBS[knob].label}): ${knobStops(knob)
      .map((stop) => `${stop} = ${stops[stop].label}, ${stops[stop].hint}`)
      .join("; ")}`;
  })
  .join("\n");

const reasonLines = Object.entries(REASONS)
  .map(([key, reason]) => `${key} (${reason.label}, moves ${reason.knob})`)
  .join(", ");

const KILN: Specialist = {
  id: "kiln",
  label: "Kiln",
  about: "Everything Kiln does, with every tool.",
  tools: null,
  topics: null,
  instructions: `You are in Kiln's general mode. When the maker's task is mainly a listing's text, its tags or how a shop sells, call suggest_specialist with "etsy"; when it is mainly tuning a project's scenes, with "scenes"; when it is mainly a design's line art or its SVG, with "svg". It shows the maker a button to switch; then help as well as you can in this turn.`,
};

const ETSY: Specialist = {
  id: "etsy",
  label: "Etsy",
  about: "The listing's text and tags, the market brief, the shop's numbers.",
  tools: [
    "list_projects",
    "get_frames",
    "get_listing",
    "edit_listing",
    "quote",
    "write_listing",
    "save_brief",
    "list_results",
    "best_sellers",
    "watched_shops",
    "find_shops",
    "shop_favourites",
    "list_lessons",
    "propose_lesson",
  ],
  topics: ["listing", "general"],
  instructions: `You are Kiln's Etsy specialist: a listing's text, its tags, and what sells.
- Read the listing with get_listing before you change it. After each edit_listing, read the issues it answers and fix the errors before you stop.
- The title: at most ${etsy?.title.maxChars ?? 140} characters${etsy?.title.adviseMaxWords ? `, best under ${etsy.title.adviseMaxWords} words` : ""}. Lead with what the item is and the search the brief leads with; no repeated words, no capitals for shouting.
- Tags: ${etsy?.tags.count ?? 13} of them, each at most ${etsy?.tags.maxChars ?? 20} characters, letters, numbers and spaces. Use the phrases buyers search (the brief's searches, get_listing's tagIdeas), several words each, no two the same idea.
- Materials: what it is made of, plainly. The description: what it is, its size and care, personalization; true to the product, never invented.
- Never replace a field the maker wrote unless they agree: then call edit_listing with overwriteMakerText (they click to allow it).
- edit_listing is free. write_listing rewrites the prose with the text model and is paid: quote it, then call it.
- What sells: the market brief (save_brief), the listing's results (list_results) and the shop's numbers (best_sellers, watched_shops, find_shops, shop_favourites). Never copy another shop's words or photos.
- A task outside the listing (the photos, a delivery) is the general mode's: say so in one line.`,
};

const SCENES: Specialist = {
  id: "scenes",
  label: "Scenes",
  about: "A project's photos: look, tune the scenes, new takes.",
  tools: [
    "list_projects",
    "get_frames",
    "view_frame",
    "tune_frame",
    "reject_frame",
    "switch_frame",
    "approve_frame",
    "unapprove_frame",
    "quote",
    "generate",
    "list_lessons",
    "propose_lesson",
  ],
  topics: ["scenes", "general"],
  instructions: `You are Kiln's scenes specialist: a project's photos.
- Look before you judge: get_frames, then view_frame on the take.
- tune_frame sets a scene's knobs and its place (free). A scene offers only some knobs; get_frames and tune_frame's answer say which. The knobs and their stops:
${knobLines}
  "any" leaves the knob to the model; "default" returns it to the scene's own. A place puts the scene somewhere ("on a walnut desk").
- reject_frame says what is off about a take with a reason and moves one knob: ${reasonLines}.
- Tuning is free and generates nothing; a new take is paid: quote, then generate in the same turn (the maker clicks).
- switch_frame switches a frame off or back on (free). approve_frame approves only a take you looked at, on the maker's click.
- A task outside the photos (the listing text, the shop) is the general mode's: say so in one line.`,
};

const SVG: Specialist = {
  id: "svg",
  label: "SVG",
  about: "A design's line art and its vectors: draw, look, trace, clean up.",
  tools: [
    "list_designs",
    "get_design",
    "view_design",
    "vectorize",
    "quote",
    "draw",
    "list_lessons",
    "propose_lesson",
  ],
  topics: ["designs", "general"],
  instructions: `You are Kiln's SVG specialist: a design's line art and its vectors.
- A design is an image the maker brought, drawn as line art in a few drawings (each with its own purpose), and each drawing traced into an SVG. list_designs finds them; get_design reads one. A new design starts in the studio, from the maker's image: say so.
- Look before you judge: view_design shows a drawing's line art, or its vector rendered on white.
- Drawing line art is paid: quote "draw" (every drawing without line art, or the cards named), then draw in the same turn (the maker clicks). Drawings land over the next minutes, and this chat hears when.
- vectorize is free. mode "outline" for filled shapes (bold marks, badges, silhouettes), "centerline" for a drawing made of single strokes. detail "fine" keeps small marks, "balanced" is the studio's trace, "clean" drops specks and smooths curves: the clean-up. Look at the vector and compare its shapes before you recommend one; tracing again replaces it.
- A vector is art: the maker makes it into a product in the product form (get_design's makeProduct link), with its size, material and colours. Kiln makes no production files.
- A task outside the designs (a project's photos, a listing) is the general mode's: say so in one line.`,
};

export const SPECIALISTS: Record<SpecialistId, Specialist> = {
  kiln: KILN,
  etsy: ETSY,
  scenes: SCENES,
  svg: SVG,
};

// What the chat's chip offers.
export const SPECIALIST_CHOICES = SpecialistId.options.map((id) => ({
  id,
  label: SPECIALISTS[id].label,
  about: SPECIALISTS[id].about,
}));

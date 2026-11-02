import { strToU8, zipSync } from "fflate";
import type { BrandKit } from "@/domain/brand";
import type { DestinationProfile } from "@/domain/destination";
import {
  exactView,
  renderTextTemplate,
  textLayerColours,
} from "@/domain/exact";
import { imageSize, rasterType } from "@/domain/image-type";
import type { ListingText } from "@/domain/listing";
import {
  bandLabel,
  CONVERSION_LABELS,
  isEmptyBrief,
  type MarketBrief,
} from "@/domain/market-brief";
import {
  type CardLike,
  deliveryBlockers,
  type PlanDestination,
  type PlanSlot,
  videoSettings,
} from "@/domain/plan";
import type { Product } from "@/domain/product";
import type { DestinationCost } from "@/domain/project-cost";
import type { PlateImage } from "@/lib/plate-href";
import {
  asJpeg,
  compositeText,
  exactFrameSvg,
  renderExactPng,
  sceneTextSvg,
  targetSize,
  upscaleScene,
} from "@/server/deliver/frames";
import { listingSheet } from "@/server/deliver/listing-sheet";

// A destination's delivery (ROADMAP principle 10, "Finished means delivered";
// Phase 11 export): every slot switched on, in the plan's order, as a file at
// the destination's pixel target — exact frames rendered from the spec, scenes
// the approved image upscaled — numbered like the destination's photos, plus
// the listing video as rendered, with a README and a manifest that say what
// produced each one. Zipped for the maker to post by hand; a human always
// publishes.

export interface SceneSource {
  prompt: string;
  provider?: string;
  model: string;
  label?: string;
  costMicros: number | null;
  generatedAt: string | null;
  seconds?: number;
  aspect?: string;
  resolution?: string;
  // It moved down its route (Settings → Models): the model it left and why.
  fallback?: { from: string; reason: string };
}

// "Gemini 3.1 Flash Image (moved from GPT Image 2: OpenAI answered 503)".
const sourceModel = (source: SceneSource) =>
  `${source.label ?? source.model}${source.fallback ? ` (moved from ${source.fallback.from}: ${source.fallback.reason})` : ""}`;

export interface DeliveryInput {
  projectName: string;
  product: Product;
  brand: BrandKit | null;
  destination: DestinationProfile;
  plan: PlanDestination;
  cardOf(slotKey: string): CardLike | undefined;
  // The product's plate for the frames drawn to scale, as a data: URL.
  plate: PlateImage | null;
  // Bytes of an approved output (storage, through the asset allowlist).
  fetchOutput(url: string): Promise<Uint8Array>;
  // What produced an approved output, when the queue knows.
  sourceOf(output: string): SceneSource | undefined;
  // The listing text (saved, else the free draft), on a destination with
  // text rules: it goes along as the paste sheet.
  listing?: ListingText;
  // Where a version or a shared frame comes from ("re-frames Hook").
  markOf?(slot: PlanSlot): string | undefined;
  // The colour and style a frame shows, for a product in more than one
  // look: how the maker links each photo to its variation.
  lookOf?(slot: PlanSlot): FrameLook | undefined;
  // What this destination's photo work cost (live spend), when it counts.
  cost?: DestinationCost;
  now: Date;
}

export interface FrameLook {
  colour: string;
  colourName: string;
  style?: string;
  styleName?: string;
  // "Gold/Black · Do not disturb".
  name: string;
}

export interface DeliveredFile {
  file: string;
  // The photo number; null for the listing video and a frame posted on its
  // own (a story, a single post).
  photo: number | null;
  slot: string;
  label: string;
  kind: "exact" | "scene" | "video" | "photo";
  width: number;
  height: number;
  seconds?: number;
  output?: string;
  source?: SceneSource;
  // A scene's own place (the maker's, often from the market brief).
  place?: string;
  // The text layer drawn over a scene by its template.
  text?: string;
  // Where a version or a shared frame comes from.
  from?: string;
  // The colour and style it shows, for a product in more than one look.
  look?: FrameLook;
  // What the frame cost, every take included (scenes and the video).
  spentMicros?: number;
  takes?: number;
}

// A clip's pixel size by resolution and orientation (Gemini Omni renders 720p;
// Veo also rendered 1080p).
const VIDEO_SIZE: Record<
  string,
  Record<"portrait" | "landscape", { width: number; height: number }>
> = {
  "720p": {
    portrait: { width: 720, height: 1280 },
    landscape: { width: 1280, height: 720 },
  },
  "1080p": {
    portrait: { width: 1080, height: 1920 },
    landscape: { width: 1920, height: 1080 },
  },
};

const extensionOf = (url: string) =>
  /\.([a-z0-9]{2,4})(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? "mp4";

export class DeliveryRefusal extends Error {}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

// The market brief in the README: why these photos, with each number's
// source and date, so the 30-day read has its "before" reason on file.
function briefLines(brief: MarketBrief | undefined): string[] {
  if (!brief || isEmptyBrief(brief)) return [];
  const search = (s: MarketBrief["searches"][number], i: number) => {
    const facts = [
      s.searches !== undefined ? `${s.searches} searches a month` : null,
      s.results !== undefined ? `${s.results} results` : null,
      s.conversion
        ? `${CONVERSION_LABELS[s.conversion].toLowerCase()} conversion`
        : s.conversionRate !== undefined
          ? `${s.conversionRate} % conversion`
          : null,
      s.price ? `median purchase ${bandLabel(s.price)}` : null,
    ].filter(Boolean);
    return `- ${i === 0 ? "Leads with" : "Also"} "${s.term}"${facts.length > 0 ? `: ${facts.join(", ")}` : ""} (${s.source}, read ${s.readOn}).`;
  };
  return [
    "",
    "Market brief (why these photos):",
    ...brief.searches.map(search),
    ...brief.notes.map(
      (n) =>
        `- Page 1${n.term ? ` for "${n.term}"` : ""}: ${n.note}${n.place ? ` Place: ${n.place}.` : ""} (read ${n.readOn})`,
    ),
  ];
}

// One delivered image in the README: what it is and what made it.
function frameLine(folder: string, f: DeliveredFile): string {
  const look = f.look ? `, in ${f.look.name}` : "";
  const what =
    f.kind === "exact"
      ? `drawn from the product spec${look}`
      : f.kind === "photo"
        ? "your photo, as on the listing"
        : `approved scene${look}${f.source ? `, ${sourceModel(f.source)}` : ""}${f.from ? `; ${f.from}` : ""}${f.place ? `, at ${f.place}` : ""}${f.text ? `, with "${f.text}" drawn by Kiln` : ""}${takesLine(f)}`;
  return `${folder}/${f.file} — ${f.label} (${what}), ${f.width} x ${f.height} px`;
}

const usd = (micros: number) =>
  `$${(micros / 1e6).toFixed(micros > 0 && micros < 10_000 ? 3 : 2)}`;

// ", $0.12 over 2 takes": a generated frame's cost, its re-rolls included.
function takesLine(f: DeliveredFile): string {
  if (f.spentMicros === undefined || !f.takes) return "";
  return `; ${usd(f.spentMicros)} over ${f.takes === 1 ? "1 take" : `${f.takes} takes`}`;
}

// The photo work in a line a business can price a product with.
function costLines(cost: DestinationCost | undefined): string[] {
  if (!cost) return [];
  return [
    "",
    cost.takes === 0
      ? "Photo work: nothing paid. Every frame was drawn from the spec or is your own photo."
      : `Photo work: ${usd(cost.spentMicros)} over ${cost.takes === 1 ? "1 take" : `${cost.takes} takes`} (rejected takes included)${cost.perApprovedMicros !== null ? `, ${usd(cost.perApprovedMicros)} per approved frame` : ""}. Exact frames, your own photos and shared frames cost nothing here.`,
  ];
}

function readme(
  input: DeliveryInput,
  files: DeliveredFile[],
  folder: string,
): string {
  const lines = [
    `${input.projectName} — ${input.destination.name}`,
    `${input.product.name} (${input.product.sku})`,
    ...(input.destination.kind === "content"
      ? [
          `Exported by Kiln on ${input.now.toISOString()}. Post the slides in this order;`,
          "slide 1 is the cover. A human publishes.",
        ]
      : [
          `Exported by Kiln on ${input.now.toISOString()}. Post the photos in this order;`,
          "photo 1 is the listing's thumbnail. A human publishes.",
        ]),
    "",
    ...files
      .filter((f) => f.photo !== null)
      .map((f) => `${f.photo}. ${frameLine(folder, f)}`),
    ...files
      .filter((f) => f.photo === null && f.kind !== "video")
      .map((f) => `On its own: ${frameLine(folder, f)}`),
    ...files
      .filter((f) => f.kind === "video")
      .map(
        (f) =>
          `Listing video: ${folder}/${f.file} — ${f.label} (approved, ${f.seconds} s${f.source ? `, ${sourceModel(f.source)}` : ""}${takesLine(f)}), ${f.width} x ${f.height} px`,
      ),
    ...costLines(input.cost),
    ...briefLines(input.plan.brief),
    "",
    "manifest.json lists each file with its source (the prompt and model of each",
    "scene, its measured cost when known).",
    ...(input.listing && input.destination.text
      ? [
          "",
          `listing.txt is the listing text, in the order of ${input.destination.name}'s listing editor;`,
          "listing.json holds the same as data.",
        ]
      : []),
  ];
  return `${lines.join("\n")}\n`;
}

export async function buildDelivery(input: DeliveryInput): Promise<{
  zip: Uint8Array;
  filename: string;
  files: DeliveredFile[];
  delivered: { key: string; approvedOutput?: string }[];
}> {
  const blockers = deliveryBlockers(input.plan, input.cardOf);
  if (blockers.notReady.length > 0) {
    throw new DeliveryRefusal(
      `Approve every scene first: ${blockers.notReady.join(", ")}.`,
    );
  }
  const folder = `${slug(input.projectName)}-${input.destination.id}`;
  const on = input.plan.slots.filter((s) => !s.off);
  const frames = new Map(input.cost?.frames.map((f) => [f.slotKey, f]));
  const costOf = (key: string) => {
    const frame = frames.get(key);
    return frame ? { spentMicros: frame.spentMicros, takes: frame.takes } : {};
  };
  const entries: Record<string, Uint8Array> = {};
  const files: DeliveredFile[] = [];
  let photo = 0;
  for (const slot of on) {
    if (slot.fill === "video") {
      const output = slot.approvedOutput;
      if (!output) {
        throw new DeliveryRefusal(`"${slot.label}" is not approved.`);
      }
      const model = input.cardOf(slot.key)?.model;
      const settings = videoSettings(
        input.plan,
        slot,
        input.destination.video,
        model,
      );
      const file = `video.${extensionOf(output)}`;
      const source = input.sourceOf(output);
      const orientation = source?.aspect
        ? source.aspect === "16:9"
          ? "landscape"
          : "portrait"
        : settings.orientation;
      const resolution = source?.resolution ?? model?.resolution ?? "720p";
      entries[`${folder}/${file}`] = await input.fetchOutput(output);
      files.push({
        file,
        photo: null,
        slot: slot.key,
        label: slot.label,
        kind: "video",
        // As rendered (the choices may have changed since).
        ...(VIDEO_SIZE[resolution] ?? VIDEO_SIZE["720p"])[orientation],
        seconds: source?.seconds ?? settings.seconds,
        output,
        source,
        ...costOf(slot.key),
      });
      continue;
    }
    // A frame posted on its own takes no number: it is named by its slot.
    const number = slot.standalone ? null : ++photo;
    const size = targetSize(slot.aspect, input.destination);
    const stem =
      number === null
        ? slot.key
        : `${String(number).padStart(2, "0")}-${slot.key}`;
    if (slot.fill === "photo" && slot.photo) {
      // The maker's own photo goes as it is: a JPEG or PNG untouched, a WebP
      // as a JPEG (Etsy takes neither WebP nor a crop of the maker's photo).
      const bytes = await input.fetchOutput(slot.photo);
      const type = rasterType(bytes);
      if (!type) {
        throw new DeliveryRefusal(
          `"${slot.label}" (photo ${number}) is not a PNG, JPEG or WebP image.`,
        );
      }
      const out = type === "image/webp" ? await asJpeg(bytes) : bytes;
      const file = `${stem}.${type === "image/png" ? "png" : "jpg"}`;
      const read = imageSize(out);
      entries[`${folder}/${file}`] = out;
      files.push({
        file,
        photo: number,
        slot: slot.key,
        label: slot.label,
        kind: "photo",
        width: read?.width ?? 0,
        height: read?.height ?? 0,
        output: slot.photo,
      });
      continue;
    }
    if (slot.fill === "exact" && slot.exact) {
      const view = exactView(
        slot.exact,
        input.product,
        slot.textTemplate,
        input.brand,
      );
      const svg = exactFrameSvg(view, slot.aspect, input.plate);
      const file = `${stem}.png`;
      entries[`${folder}/${file}`] = renderExactPng(svg, size.width);
      const look = input.lookOf?.(slot);
      files.push({
        file,
        photo: number,
        slot: slot.key,
        label: slot.label,
        kind: "exact",
        ...size,
        ...(look ? { look } : {}),
      });
      continue;
    }
    const output = slot.approvedOutput;
    if (!output) throw new DeliveryRefusal(`"${slot.label}" is not approved.`);
    const file = `${stem}.jpg`;
    const scene = await upscaleScene(await input.fetchOutput(output), size);
    // A slot's text layer is drawn by its template over the approved image,
    // as the board shows it; the image model never draws it.
    const text = slot.textTemplate
      ? renderTextTemplate(slot.textTemplate, input.product)
      : undefined;
    entries[`${folder}/${file}`] = text
      ? await compositeText(
          scene,
          renderExactPng(
            sceneTextSvg(text, textLayerColours(input.brand), slot.aspect),
            size.width,
          ),
        )
      : scene;
    const from = input.markOf?.(slot);
    const look = input.lookOf?.(slot);
    files.push({
      file,
      photo: number,
      slot: slot.key,
      label: slot.label,
      kind: "scene",
      ...size,
      output,
      source: input.sourceOf(output),
      ...(look ? { look } : {}),
      ...(slot.place ? { place: slot.place } : {}),
      ...(text ? { text } : {}),
      ...(from ? { from } : {}),
      ...costOf(slot.key),
    });
  }
  const manifest = {
    project: input.projectName,
    product: { sku: input.product.sku, name: input.product.name },
    destination: input.destination.id,
    exportedAt: input.now.toISOString(),
    ...(input.cost
      ? {
          cost: {
            spentMicros: input.cost.spentMicros,
            takes: input.cost.takes,
            approved: input.cost.approved,
            perApprovedMicros: input.cost.perApprovedMicros,
          },
        }
      : {}),
    files,
    ...(input.plan.brief && !isEmptyBrief(input.plan.brief)
      ? { brief: input.plan.brief }
      : {}),
  };
  entries[`${folder}/README.txt`] = strToU8(readme(input, files, folder));
  if (input.listing && input.destination.text) {
    entries[`${folder}/listing.txt`] = strToU8(
      listingSheet({
        channel: input.destination.name,
        product: input.product,
        listing: input.listing,
        rules: input.destination.text,
      }),
    );
    entries[`${folder}/listing.json`] = strToU8(
      `${JSON.stringify(input.listing, null, 2)}\n`,
    );
  }
  entries[`${folder}/manifest.json`] = strToU8(
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return {
    // Images are already compressed: stored, not deflated again.
    zip: zipSync(entries, { level: 0 }),
    filename: `${folder}.zip`,
    files,
    delivered: on.map((s) => ({
      key: s.key,
      ...(s.approvedOutput ? { approvedOutput: s.approvedOutput } : {}),
    })),
  };
}

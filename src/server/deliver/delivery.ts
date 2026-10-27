import { strToU8, zipSync } from "fflate";
import type { BrandKit } from "@/domain/brand";
import type { DestinationProfile } from "@/domain/destination";
import { exactView } from "@/domain/exact";
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
  videoSettings,
} from "@/domain/plan";
import type { Product } from "@/domain/product";
import type { PlateImage } from "@/lib/plate-href";
import {
  asJpeg,
  exactFrameSvg,
  renderExactPng,
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
}

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
  now: Date;
}

export interface DeliveredFile {
  file: string;
  // The photo number; null for the listing video.
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
}

// A clip's pixel size by resolution and orientation (Veo; Sora rendered 720p).
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

function readme(
  input: DeliveryInput,
  files: DeliveredFile[],
  folder: string,
): string {
  const lines = [
    `${input.projectName} — ${input.destination.name}`,
    `${input.product.name} (${input.product.sku})`,
    `Exported by Kiln on ${input.now.toISOString()}. Post the photos in this order;`,
    "photo 1 is the listing's thumbnail. A human publishes.",
    "",
    ...files.map((f) =>
      f.kind === "video"
        ? `Listing video: ${folder}/${f.file} — ${f.label} (approved, ${f.seconds} s${f.source ? `, ${f.source.label ?? f.source.model}` : ""}), ${f.width} x ${f.height} px`
        : `${f.photo}. ${folder}/${f.file} — ${f.label} (${f.kind === "exact" ? "drawn from the product spec" : f.kind === "photo" ? "your photo, as on the listing" : `approved scene${f.source ? `, ${f.source.label ?? f.source.model}` : ""}${f.place ? `, at ${f.place}` : ""}`}), ${f.width} x ${f.height} px`,
    ),
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
  if (blockers.textOnScenes.length > 0) {
    throw new DeliveryRefusal(
      `Scenes with text on the image are not exported yet (${blockers.textOnScenes.join(", ")}).`,
    );
  }
  if (blockers.notReady.length > 0) {
    throw new DeliveryRefusal(
      `Approve every scene first: ${blockers.notReady.join(", ")}.`,
    );
  }
  const folder = `${slug(input.projectName)}-${input.destination.id}`;
  const on = input.plan.slots.filter((s) => !s.off);
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
      });
      continue;
    }
    photo += 1;
    const size = targetSize(slot.aspect, input.destination);
    const stem = `${String(photo).padStart(2, "0")}-${slot.key}`;
    if (slot.fill === "photo" && slot.photo) {
      // The maker's own photo goes as it is: a JPEG or PNG untouched, a WebP
      // as a JPEG (Etsy takes neither WebP nor a crop of the maker's photo).
      const bytes = await input.fetchOutput(slot.photo);
      const type = rasterType(bytes);
      if (!type) {
        throw new DeliveryRefusal(
          `"${slot.label}" (photo ${photo}) is not a PNG, JPEG or WebP image.`,
        );
      }
      const out = type === "image/webp" ? await asJpeg(bytes) : bytes;
      const file = `${stem}.${type === "image/png" ? "png" : "jpg"}`;
      const read = imageSize(out);
      entries[`${folder}/${file}`] = out;
      files.push({
        file,
        photo,
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
      files.push({
        file,
        photo,
        slot: slot.key,
        label: slot.label,
        kind: "exact",
        ...size,
      });
      continue;
    }
    const output = slot.approvedOutput;
    if (!output) throw new DeliveryRefusal(`"${slot.label}" is not approved.`);
    const file = `${stem}.jpg`;
    entries[`${folder}/${file}`] = await upscaleScene(
      await input.fetchOutput(output),
      size,
    );
    files.push({
      file,
      photo,
      slot: slot.key,
      label: slot.label,
      kind: "scene",
      ...size,
      output,
      source: input.sourceOf(output),
      ...(slot.place ? { place: slot.place } : {}),
    });
  }
  const manifest = {
    project: input.projectName,
    product: { sku: input.product.sku, name: input.product.name },
    destination: input.destination.id,
    exportedAt: input.now.toISOString(),
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

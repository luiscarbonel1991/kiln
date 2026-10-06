import { strToU8, zipSync } from "fflate";
import type { BrandKit } from "@/domain/brand";
import type { DestinationProfile } from "@/domain/destination";
import { exactView } from "@/domain/exact";
import {
  type CardLike,
  deliveryBlockers,
  type PlanDestination,
  videoSettings,
} from "@/domain/plan";
import type { Product } from "@/domain/product";
import type { PlateImage } from "@/lib/plate-href";
import {
  exactFrameSvg,
  renderExactPng,
  targetSize,
  upscaleScene,
} from "@/server/deliver/frames";

// A destination's delivery (ROADMAP principle 10, "Finished means delivered";
// Phase 11 export): every slot switched on, in the plan's order, as a file at
// the destination's pixel target — exact frames rendered from the spec, scenes
// the approved image upscaled — numbered like the destination's photos, plus
// the listing video as rendered, with a README and a manifest that say what
// produced each one. Zipped for the maker to post by hand; a human always
// publishes.

export interface SceneSource {
  prompt: string;
  model: string;
  costMicros: number | null;
  generatedAt: string | null;
  seconds?: number;
  aspect?: string;
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
  now: Date;
}

export interface DeliveredFile {
  file: string;
  // The photo number; null for the listing video.
  photo: number | null;
  slot: string;
  label: string;
  kind: "exact" | "scene" | "video";
  width: number;
  height: number;
  seconds?: number;
  output?: string;
  source?: SceneSource;
}

// Sora renders 720 x 1280 (vertical) or 1280 x 720 (landscape).
const VIDEO_SIZE = {
  portrait: { width: 720, height: 1280 },
  landscape: { width: 1280, height: 720 },
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
        ? `Listing video: ${folder}/${f.file} — ${f.label} (approved, ${f.seconds} s${f.source ? `, ${f.source.model}` : ""}), ${f.width} x ${f.height} px`
        : `${f.photo}. ${folder}/${f.file} — ${f.label} (${f.kind === "exact" ? "drawn from the product spec" : `approved scene${f.source ? `, ${f.source.model}` : ""}`}), ${f.width} x ${f.height} px`,
    ),
    "",
    "manifest.json lists each file with its source (the prompt and model of each",
    "scene, its measured cost when known).",
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
      const settings = videoSettings(input.plan, slot, input.destination.video);
      const file = `video.${extensionOf(output)}`;
      const source = input.sourceOf(output);
      entries[`${folder}/${file}`] = await input.fetchOutput(output);
      files.push({
        file,
        photo: null,
        slot: slot.key,
        label: slot.label,
        kind: "video",
        // As rendered (the choices may have changed since).
        ...VIDEO_SIZE[
          source?.aspect
            ? source.aspect === "16:9"
              ? "landscape"
              : "portrait"
            : settings.orientation
        ],
        seconds: source?.seconds ?? settings.seconds,
        output,
        source,
      });
      continue;
    }
    photo += 1;
    const size = targetSize(slot.aspect, input.destination);
    const stem = `${String(photo).padStart(2, "0")}-${slot.key}`;
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
    });
  }
  const manifest = {
    project: input.projectName,
    product: { sku: input.product.sku, name: input.product.name },
    destination: input.destination.id,
    exportedAt: input.now.toISOString(),
    files,
  };
  entries[`${folder}/README.txt`] = strToU8(readme(input, files, folder));
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

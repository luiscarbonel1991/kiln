import { createHash } from "node:crypto";
import {
  GenerationRequest,
  type ImageGenerationRequest,
} from "@/domain/generation-request";
import {
  type PlanSlot,
  ProjectPlan,
  parseSlotCardId,
  type SlotRef,
  SlotRefusal,
  slotCardId,
} from "@/domain/plan";
import { slotProduct } from "@/domain/plan-look";
import { Product } from "@/domain/product";
import { readTakeCheck, type TakeCheck, withLook } from "@/domain/qc";
import { sizeCueIn } from "@/domain/scene-direction";
import { assertDatabaseUrl, db } from "@/lib/db";
import { fetchAsset } from "@/providers/asset-bytes";
import type { MakerRef } from "@/server/maker-repository";
import { rowToProduct } from "@/server/product-mapper";
import { checkTake, type Reading } from "@/server/qc/check-take";
import { ocrEngine } from "@/server/qc/ocr";

// The take check of a project's scene: the wording of the product in the
// frame's look, the inks its pieces are drawn in (to find a stack of loose
// characters), the size its prompt asked for, and the reference it edited.

interface TakeContext {
  wording: string[];
  inks: string[];
}

async function takeContext(
  projectId: string,
  cardId: string,
): Promise<TakeContext | null> {
  const ref = parseSlotCardId(cardId);
  if (!ref) return null;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      plan: true,
      products: {
        orderBy: { position: "asc" },
        take: 1,
        select: {
          productSnapshot: true,
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              spec: true,
              source: true,
            },
          },
        },
      },
    },
  });
  const plan = ProjectPlan.safeParse(project?.plan).data;
  if (!project || !plan) return null;
  const slot: PlanSlot | undefined = plan.destinations
    .find((d) => d.destinationId === ref.destinationId)
    ?.slots.find((s) => s.key === ref.slotKey);
  if (!slot) return null;
  // The version of the product the project follows.
  const link = project.products[0];
  const product = link
    ? (Product.safeParse(link.productSnapshot).data ??
      rowToProduct(link.product) ??
      null)
    : null;
  if (!product) return { wording: [], inks: [] };
  const look = slotProduct(product, plan, slot);
  const colour = look.colours.find((c) => c.key === look.defaultColour);
  const inks = [
    colour?.inlay,
    colour?.face,
    colour?.edge,
    ...(look.parts ?? []).map((p) => p.colour?.hex),
  ].filter((hex): hex is string => typeof hex === "string");
  return {
    wording: look.wording
      .map((w) => w.example?.trim() ?? "")
      .filter((e) => e !== ""),
    inks: [...new Set(inks.map((hex) => hex.toLowerCase()))],
  };
}

// A batch edits one reference many times: its reading is kept for the next
// take (a few at a time, by the reference, the wording and the inks).
const READINGS = new Map<string, Promise<Reading | null>>();
const KEEP = 16;

function remembered(key: string) {
  return (read: () => Promise<Reading | null>) => {
    const known = READINGS.get(key);
    if (known) return known;
    const reading = read().catch((error) => {
      READINGS.delete(key);
      throw error;
    });
    READINGS.set(key, reading);
    while (READINGS.size > KEEP) {
      const oldest = READINGS.keys().next().value;
      if (oldest === undefined) break;
      READINGS.delete(oldest);
    }
    return reading;
  };
}

async function fetched(url: string) {
  try {
    const asset = await fetchAsset(url);
    return { bytes: new Uint8Array(asset.bytes), mime: asset.mime };
  } catch {
    return null;
  }
}

export async function checkProjectTake(
  job: { projectId: string | null; cardId: string },
  request: ImageGenerationRequest,
  take: { bytes: Uint8Array; mime: string },
): Promise<TakeCheck | null> {
  if (!job.projectId) return null;
  const context = await takeContext(job.projectId, job.cardId);
  if (!context) return null;
  const key = createHash("sha1")
    .update(
      [request.masterAssetUrl, ...context.wording, ...context.inks].join("\n"),
    )
    .digest("hex");
  return checkTake({
    take,
    reference: await fetched(request.masterAssetUrl),
    expected: context.wording,
    inks: context.inks,
    scale: sizeCueIn(request.prompt),
    ocr: await ocrEngine(),
    checkedAt: new Date().toISOString(),
    readReference: remembered(key),
  });
}

// A frame's shown take, checked again (free): one from before the check, or
// one left unchecked. The check is written on the job that made the take.
export async function recheckTake(
  maker: MakerRef,
  projectId: string,
  ref: SlotRef,
): Promise<TakeCheck> {
  assertDatabaseUrl();
  const cardId = slotCardId(ref.destinationId, ref.slotKey);
  const card = await db.card.findFirst({
    where: { projectId, cardId, project: { makerId: maker.id } },
    select: { outputs: true },
  });
  const outputs = Array.isArray(card?.outputs) ? card.outputs : [];
  const output = typeof outputs[0] === "string" ? outputs[0] : null;
  if (!output) {
    throw new SlotRefusal("missing", "That frame has no take to check.");
  }
  const job = await db.generationJob.findFirst({
    where: { projectId, cardId, status: "done", outputUrl: output },
    orderBy: { finishedAt: "desc" },
    select: { id: true, request: true, takeCheck: true },
  });
  const request = GenerationRequest.safeParse(job?.request).data;
  if (!job || request?.kind !== "image") {
    throw new SlotRefusal(
      "refused",
      "Kiln has no record of how this take was made, so it cannot check it.",
    );
  }
  const take = await fetched(output);
  if (!take) {
    throw new SlotRefusal("refused", "That take could not be fetched.");
  }
  const read = await checkProjectTake({ projectId, cardId }, request, take);
  if (!read) {
    throw new SlotRefusal("refused", "That frame is not a scene Kiln checks.");
  }
  // The look was paid for when the take landed: a free recheck keeps it.
  const look = readTakeCheck(job.takeCheck)?.look;
  const check = look ? withLook(read, look) : read;
  await db.generationJob.update({
    where: { id: job.id },
    data: { takeCheck: check },
  });
  return check;
}

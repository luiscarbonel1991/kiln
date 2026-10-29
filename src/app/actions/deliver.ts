"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { listingDraft } from "@/domain/listing";
import { slotCardId } from "@/domain/plan";
import { plateHref } from "@/lib/plate-href";
import { CATALOG } from "@/lib/recipes";
import { versionMark } from "@/lib/version-mark";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { buildDelivery, DeliveryRefusal } from "@/server/deliver/delivery";
import { outputSources } from "@/server/generation-repository";
import { readBeforeAtDelivery } from "@/server/listing-results";
import { getMakerBrand } from "@/server/maker-repository";
import { loadProjectBoard, setDelivered } from "@/server/project-repository";

// Deliver one destination of a planned project: a zip of its files (ROADMAP
// "Deliver"), stored and handed back as a link the board downloads; the slots
// it exported are stamped delivered, and a sale destination with a connected
// shop takes its before read. Server Functions are POST-reachable: Zod
// is the trust boundary; every read and write is scoped to the current maker.

const Input = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
});

export type DeliverResult =
  | { url: string; filename: string; count: number }
  | { error: string };

async function dataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const { base64, mime } = await fetchAsset(url);
  return `data:${mime};base64,${base64}`;
}

export async function deliverAction(input: unknown): Promise<DeliverResult> {
  const { projectId, destinationId } = Input.parse(input);
  const loaded = await loadProjectBoard(projectId);
  const plan = loaded?.board.plan?.destinations.find(
    (d) => d.destinationId === destinationId,
  );
  const destination = CATALOG.destinations.find((d) => d.id === destinationId);
  if (!loaded?.product || !plan || !destination) {
    return { error: "This destination is not part of a planned project." };
  }
  const fullPlan = loaded.board.plan;
  if (!fullPlan) {
    return { error: "This destination is not part of a planned project." };
  }
  const cards = new Map(loaded.board.cards.map((c) => [c.id, c]));
  const outputs = plan.slots.flatMap((s) =>
    !s.off && s.approvedOutput ? [s.approvedOutput] : [],
  );
  try {
    const plate = plateHref(loaded.product);
    const sources = await outputSources(projectId, outputs);
    const now = new Date();
    // resvg fetches nothing: the colour sheet's material samples go inline.
    const product = {
      ...loaded.product,
      colours: await Promise.all(
        loaded.product.colours.map(async (c) =>
          c.swatchUrl ? { ...c, swatchUrl: await dataUrl(c.swatchUrl) } : c,
        ),
      ),
    };
    const result = await buildDelivery({
      projectName: loaded.board.name,
      product,
      brand: await getMakerBrand(),
      destination,
      plan,
      cardOf: (key) => cards.get(slotCardId(destinationId, key)),
      plate: plate ? { ...plate, href: await dataUrl(plate.href) } : null,
      fetchOutput: async (url) => (await fetchAsset(url)).bytes,
      sourceOf: (output) => sources.get(output),
      markOf: (slot) => versionMark(fullPlan, slot, { waits: false }),
      ...(destination.text
        ? {
            listing:
              plan.listing ?? listingDraft(loaded.product, destination.text),
          }
        : {}),
      now,
    });
    const url = await storeAsset(result.zip, "application/zip", "deliveries");
    await setDelivered(
      projectId,
      destinationId,
      result.delivered,
      now.toISOString(),
    );
    await readBeforeAtDelivery(projectId, destinationId);
    refresh();
    return { url, filename: result.filename, count: result.files.length };
  } catch (error) {
    if (error instanceof DeliveryRefusal) return { error: error.message };
    console.warn("[kiln deliver] the export failed", error);
    return {
      error: `The export failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

import { listingDraft } from "@/domain/listing";
import { type PlanSlot, slotCardId } from "@/domain/plan";
import { projectLook, projectProduct, slotLook } from "@/domain/plan-look";
import { colourOf, type Product } from "@/domain/product";
import { lookLabel, productStyles, styleName } from "@/domain/product-look";
import { projectCost } from "@/domain/project-cost";
import { plateHref } from "@/lib/plate-href";
import { CATALOG } from "@/lib/recipes";
import { versionMark } from "@/lib/version-mark";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { providerMode } from "@/providers/mode";
import {
  buildDelivery,
  type DeliveryInput,
  DeliveryRefusal,
} from "@/server/deliver/delivery";
import { outputSources, projectSpend } from "@/server/generation-repository";
import { readBeforeAtDelivery } from "@/server/listing-results";
import type { MakerRef } from "@/server/maker-repository";
import { getMakerBrand } from "@/server/maker-repository";
import { loadProjectBoard, setDelivered } from "@/server/project-repository";

// Deliver one destination of a planned project: a zip of its files, stored and
// handed back as a link; the slots it exported are stamped delivered, and a
// sale destination with a connected shop takes its before read. The board's
// action and the deliver tool run it the same way; every read and write is
// scoped to the current maker.

export type DeliverResult =
  | { url: string; filename: string; count: number }
  | { error: string };

async function dataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const { base64, mime } = await fetchAsset(url);
  return `data:${mime};base64,${base64}`;
}

// What a destination of a planned project delivers, ready for buildDelivery
// (or deliveredFiles): the product as the project shows it, its frames and
// their sources. Null when the destination is not part of a planned project.
export async function destinationDelivery(
  maker: MakerRef,
  projectId: string,
  destinationId: string,
  now = new Date(),
): Promise<{ input: DeliveryInput; product: Product } | null> {
  const loaded = await loadProjectBoard(maker, projectId);
  const plan = loaded?.board.plan?.destinations.find(
    (d) => d.destinationId === destinationId,
  );
  const destination = CATALOG.destinations.find((d) => d.id === destinationId);
  const fullPlan = loaded?.board.plan;
  if (!loaded?.product || !plan || !destination || !fullPlan) return null;
  const cards = new Map(loaded.board.cards.map((c) => [c.id, c]));
  const outputs = plan.slots.flatMap((s) =>
    !s.off && s.approvedOutput ? [s.approvedOutput] : [],
  );
  // Exact frames draw the product as the project shows it (its look).
  const shown = projectProduct(loaded.product, fullPlan);
  const plate = plateHref(shown);
  const sources = await outputSources(maker, projectId, outputs);
  // resvg fetches nothing: the colour sheet's material samples go inline.
  const product = {
    ...shown,
    colours: await Promise.all(
      shown.colours.map(async (c) =>
        c.swatchUrl ? { ...c, swatchUrl: await dataUrl(c.swatchUrl) } : c,
      ),
    ),
  };
  const stored = loaded.product;
  return {
    product: stored,
    input: {
      projectName: loaded.board.name,
      product,
      brand: await getMakerBrand(maker),
      destination,
      plan,
      cardOf: (key) => cards.get(slotCardId(destinationId, key)),
      plate: plate ? { ...plate, href: await dataUrl(plate.href) } : null,
      fetchOutput: async (url) => (await fetchAsset(url)).bytes,
      sourceOf: (output) => sources.get(output),
      markOf: (slot) => versionMark(fullPlan, slot, { waits: false }),
      // Each frame's colour and style, for a product in more than one look:
      // exact frames are drawn in the project's, scenes in their own.
      ...(stored.colours.length > 1 || productStyles(stored).length > 0
        ? {
            lookOf: (slot: PlanSlot) => {
              // The colour sheet shows every colour; a text card none.
              if (slot.exact === "colour-grid" || slot.exact === "text-card") {
                return undefined;
              }
              const look =
                slot.fill === "scene"
                  ? slotLook(fullPlan, slot, stored)
                  : projectLook(fullPlan, stored);
              return {
                colour: look.colour,
                colourName: colourOf(stored, look.colour).name,
                ...(look.style
                  ? {
                      style: look.style,
                      styleName: styleName(stored, look.style),
                    }
                  : {}),
                name: lookLabel(stored, look),
              };
            },
          }
        : {}),
      // Spend counts in a live run only (mock jobs are never paid).
      ...(providerMode() === "live"
        ? {
            cost: projectCost(
              fullPlan,
              (await projectSpend(maker, projectId)).byCard,
            ).destinations.find((d) => d.destinationId === destinationId),
          }
        : {}),
      ...(destination.text
        ? { listing: plan.listing ?? listingDraft(stored, destination.text) }
        : {}),
      now,
    },
  };
}

export async function deliverDestination(
  maker: MakerRef,
  projectId: string,
  destinationId: string,
): Promise<DeliverResult> {
  try {
    const now = new Date();
    const delivery = await destinationDelivery(
      maker,
      projectId,
      destinationId,
      now,
    );
    if (!delivery) {
      return { error: "This destination is not part of a planned project." };
    }
    const result = await buildDelivery(delivery.input);
    const url = await storeAsset(result.zip, "application/zip", "deliveries");
    await setDelivered(
      maker,
      projectId,
      destinationId,
      result.delivered,
      now.toISOString(),
    );
    await readBeforeAtDelivery(maker, projectId, destinationId);
    return { url, filename: result.filename, count: result.files.length };
  } catch (error) {
    if (error instanceof DeliveryRefusal) return { error: error.message };
    console.warn("[kiln deliver] the export failed", error);
    return {
      error: `The export failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

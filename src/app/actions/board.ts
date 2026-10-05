"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import { productUnderstanding } from "@/domain/product-understanding";
import { slotCards } from "@/lib/project-start";
import { getStorageProvider } from "@/providers/registry";
import {
  loadProjectBoard,
  setProjectReference,
  setSlotApproval,
  setSlotOff,
} from "@/server/project-repository";

// Board mutations. Server Functions are POST-reachable: Zod is the trust
// boundary, and every write is scoped to the current maker by the repository.

const Approval = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  approved: z.boolean(),
});

export async function setSlotApprovalAction(input: unknown): Promise<void> {
  const { projectId, destinationId, slotKey, approved } = Approval.parse(input);
  await setSlotApproval(projectId, { destinationId, slotKey }, approved);
  refresh();
}

const Switch = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  off: z.boolean(),
});

export async function setSlotOffAction(
  input: unknown,
): Promise<{ error: string } | undefined> {
  const { projectId, destinationId, slotKey, off } = Switch.parse(input);
  try {
    await setSlotOff(projectId, { destinationId, slotKey }, off);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not switch it.",
    };
  }
  refresh();
}

const EXTENSION: Record<(typeof ACCEPTED_IMAGE_MIME)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Upload the product's reference (a photo, or the plate from the maker's own
// renderer) and make it the project's anchor. The file and the project id come
// in one form, so no client-supplied URL is ever fetched by the server.
export async function addReferenceAction(formData: FormData): Promise<void> {
  const projectId = z.string().min(1).parse(formData.get("projectId"));
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");
  const mime = z.enum(ACCEPTED_IMAGE_MIME).parse(file.type);
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("Image is larger than 15 MB.");

  const loaded = await loadProjectBoard(projectId);
  if (!loaded?.board.plan || !loaded.product) {
    throw new Error("Only a planned project with a product takes a reference.");
  }
  const { url } = await getStorageProvider().put({
    key: `masters/${randomUUID()}.${EXTENSION[mime]}`,
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: mime,
  });
  const master = {
    id: randomUUID(),
    origin: "product" as const,
    sourcePrompt: null,
    assetUrl: url,
    mime,
  };
  const cards =
    loaded.board.cards.length === 0
      ? slotCards(
          loaded.board.plan,
          master,
          productUnderstanding(loaded.product),
          loaded.product.useContexts,
        )
      : [];
  await setProjectReference(projectId, master, cards);
  refresh();
}

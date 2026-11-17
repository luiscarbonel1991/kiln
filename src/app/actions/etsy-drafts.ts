"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/components/studio/constants";
import type { FieldChange } from "@/domain/etsy-draft";
import { DraftSettings, WhenMade, WhoMade } from "@/domain/etsy-draft";
import { rasterType } from "@/domain/image-type";
import { EtsyError } from "@/providers/shop/etsy";
import {
  addDraftPhoto,
  createDraftFromProject,
  type DraftMade,
  DraftRefusal,
  type ReadBack,
  removeDraftPhoto,
  sendMissingPhotos,
  updateDraft,
} from "@/server/etsy-drafts";
import { requireMaker } from "@/server/session";

// The drafts pages' writes to the maker's Etsy shop. Each one is the maker's
// click after a confirm; the rules around every write (a draft only, never a
// state, made once, logged) hold in src/server/etsy-drafts.ts.

const said = (error: unknown) =>
  error instanceof DraftRefusal
    ? error.message
    : error instanceof EtsyError
      ? `Etsy said: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);

const ListingId = z.number().int().positive();

const CreateInput = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  settings: DraftSettings,
  requestKey: z.string().uuid(),
});

export async function createDraftAction(
  input: unknown,
): Promise<{ made: DraftMade } | { error: string }> {
  await requireMaker();
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) return { error: "Which draft?" };
  try {
    const made = await createDraftFromProject({
      ...parsed.data,
      by: "Drafts page",
    });
    refresh();
    return { made };
  } catch (error) {
    return { error: said(error) };
  }
}

const Words = z.array(z.string().trim().min(1).max(60)).max(40);

const UpdateInput = z.object({
  listingId: ListingId,
  change: z
    .object({
      title: z.string().trim().min(1).max(140),
      description: z.string().trim().min(1).max(20_000),
      tags: Words,
      materials: Words,
      taxonomyId: z.number().int().positive(),
      whoMade: WhoMade,
      whenMade: WhenMade,
      shippingProfileId: z.number().int().positive(),
      readinessStateId: z.number().int().positive(),
      price: z.number().positive().max(50_000),
      quantity: z.number().int().min(0).max(999),
    })
    .partial()
    .strict(),
});

export async function updateDraftAction(
  input: unknown,
): Promise<
  { changes: FieldChange[]; readBack: ReadBack[] } | { error: string }
> {
  await requireMaker();
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Those changes do not read.",
    };
  }
  try {
    const result = await updateDraft(
      parsed.data.listingId,
      parsed.data.change,
      "Drafts page",
    );
    refresh();
    return result;
  } catch (error) {
    return { error: said(error) };
  }
}

// A photo the maker adds to a draft: a JPEG or PNG as it is (Etsy takes no
// WebP), 15 MB at most.
export async function addDraftPhotoAction(
  formData: FormData,
): Promise<{ error?: string }> {
  await requireMaker();
  const listingId = ListingId.safeParse(Number(formData.get("listingId")));
  const file = formData.get("file");
  if (!listingId.success || !(file instanceof File)) {
    return { error: "No photo was sent." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `${file.name} is larger than 15 MB.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = rasterType(bytes);
  if (mime !== "image/jpeg" && mime !== "image/png") {
    return { error: `${file.name}: add it as a JPEG or PNG.` };
  }
  try {
    await addDraftPhoto(
      listingId.data,
      { bytes, mime, filename: file.name },
      "Drafts page",
    );
    refresh();
    return {};
  } catch (error) {
    return { error: said(error) };
  }
}

const PhotoInput = z.object({
  listingId: ListingId,
  imageId: z.number().int().positive(),
});

export async function removeDraftPhotoAction(
  input: unknown,
): Promise<{ error?: string }> {
  await requireMaker();
  const parsed = PhotoInput.safeParse(input);
  if (!parsed.success) return { error: "Which photo?" };
  try {
    await removeDraftPhoto(
      parsed.data.listingId,
      parsed.data.imageId,
      "Drafts page",
    );
    refresh();
    return {};
  } catch (error) {
    return { error: said(error) };
  }
}

export async function sendMissingPhotosAction(
  input: unknown,
): Promise<{ sent: number; missing: string[] } | { error: string }> {
  await requireMaker();
  const parsed = z.object({ listingId: ListingId }).safeParse(input);
  if (!parsed.success) return { error: "Which draft?" };
  try {
    const result = await sendMissingPhotos(
      parsed.data.listingId,
      "Drafts page",
    );
    refresh();
    return result;
  } catch (error) {
    return { error: said(error) };
  }
}

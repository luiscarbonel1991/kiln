import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "@/components/studio/constants";
import { rasterType } from "@/domain/image-type";
import { threeQuarterFor } from "@/domain/scene-reference";
import { refreshCards } from "@/lib/project-refresh";
import { slotCards } from "@/lib/project-start";
import { getStorageProvider } from "@/providers/registry";
import { megabytes } from "@/server/http-api";
import type { MakerRef } from "@/server/maker-repository";
import { getMakerModels } from "@/server/maker-repository";
import {
  loadProjectBoard,
  setProjectReference,
} from "@/server/project-repository";

const EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type ReferenceOutcome =
  | { ok: true; project: string; reference: string; first: boolean }
  | { ok: false; status: 400 | 404 | 413 | 415; error: string };

// The product's reference (a photo, or the plate from the maker's own
// renderer) made the project's anchor: what the board's "Add reference image"
// does, for the board, the HTTP API and the tools alike. The bytes come with
// the call, so the server never fetches an address a caller names, and what
// they are is read from them, not from a declared type.
export async function addProjectReference(
  maker: MakerRef,
  projectId: string,
  bytes: Uint8Array,
): Promise<ReferenceOutcome> {
  if (bytes.length === 0) {
    return { ok: false, status: 400, error: "The image is empty." };
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `A reference image is at most ${megabytes(MAX_UPLOAD_BYTES)}.`,
    };
  }
  const mime = rasterType(bytes);
  if (!mime) {
    return {
      ok: false,
      status: 415,
      error: "A reference image must be a PNG, JPEG or WebP image.",
    };
  }
  const loaded = await loadProjectBoard(maker, projectId);
  if (!loaded) {
    return {
      ok: false,
      status: 404,
      error: "No project of yours has that id.",
    };
  }
  if (!loaded.board.plan || !loaded.product) {
    return {
      ok: false,
      status: 400,
      error: "Only a planned project with a product takes a reference.",
    };
  }
  const { url } = await getStorageProvider().put({
    key: `masters/${randomUUID()}.${EXTENSION[mime]}`,
    body: bytes,
    contentType: mime,
  });
  const master = {
    id: randomUUID(),
    origin: "product" as const,
    sourcePrompt: null,
    assetUrl: url,
    mime,
  };
  const { plan } = loaded.board;
  const { product } = loaded;
  const write = async () =>
    slotCards(plan, master, product, await getMakerModels(maker));
  const first = loaded.board.cards.length === 0;
  // The view from above was drawn beside Kiln's plate: with the maker's own
  // reference it no longer applies, so the scenes Kiln started a little above
  // are written again (the maker's own edits stay).
  const rewrite =
    !first &&
    threeQuarterFor(plan.references, loaded.board.master?.assetUrl) !== null;
  await setProjectReference(
    maker,
    projectId,
    master,
    first ? await write() : [],
    rewrite ? refreshCards(loaded.board.cards, await write(), master.id) : [],
  );
  return { ok: true, project: projectId, reference: url, first };
}

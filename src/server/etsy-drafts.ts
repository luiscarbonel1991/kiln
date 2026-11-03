import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  type DraftFields,
  type DraftPhoto,
  DraftSettings,
  draftChanges,
  draftProposal,
  ETSY_MAX_PHOTOS,
  type FieldChange,
  moneyValue,
} from "@/domain/etsy-draft";
import { deliveryBlockers, type PlanDestination } from "@/domain/plan";
import { etsyText } from "@/domain/shop-ranking";
import { db, hasDatabase } from "@/lib/db";
import { CATALOG } from "@/lib/recipes";
import { allPages, EtsyError } from "@/providers/shop/etsy";
import {
  type DraftEdit as DraftTextEdit,
  type EtsyDraftListing,
  singleOffering,
  type TaxonomyChoice,
} from "@/providers/shop/etsy-drafts";
import { destinationDelivery } from "@/server/deliver/deliver-destination";
import {
  type DeliveryInput,
  DeliveryRefusal,
  deliveredFiles,
} from "@/server/deliver/delivery";
import { getCurrentMaker } from "@/server/maker-repository";
import {
  type ConnectedEtsy,
  connectedEtsy,
  ShopNeedsReconnect,
} from "@/server/shop-connection";

// The maker's Etsy drafts (ROADMAP Phase 11; Luis, 2026-11-02: drafts first,
// so nothing live is touched). Etsy's write scope is all-or-nothing, so the
// rules are Kiln's, and each holds here:
// - a listing is changed only while it is a draft of the connected shop,
//   checked against Etsy right before the change (editableDraft);
// - nothing publishes (no request carries a state: etsySend) and nothing is
//   deleted but a draft's photo;
// - a draft made from a preview is made once (its request key);
// - a draft with variations keeps them (its price is not rewritten);
// - every write is logged (ShopWrite) and read back against what was sent.

export class DraftRefusal extends Error {
  readonly name = "DraftRefusal";
}

export type DraftWriter = "Drafts page" | "Board" | "Chat";

const PLATFORM = "etsy";
const MAX_DRAFT_PAGES = 5;

export const etsyEditorUrl = (listingId: number | string) =>
  `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`;

async function shopOrRefuse(): Promise<ConnectedEtsy> {
  let etsy: ConnectedEtsy | null;
  try {
    etsy = await connectedEtsy();
  } catch (error) {
    if (error instanceof ShopNeedsReconnect) {
      throw new DraftRefusal(error.message);
    }
    throw error;
  }
  if (!etsy) {
    throw new DraftRefusal("No shop is connected: connect one in Shops.");
  }
  return etsy;
}

async function writableShop(): Promise<ConnectedEtsy> {
  const etsy = await shopOrRefuse();
  if (!etsy.draftsAllowed) {
    throw new DraftRefusal(
      `Kiln may not write drafts to ${etsy.shopName} yet: connect the shop again to allow it.`,
    );
  }
  return etsy;
}

const said = (error: unknown) =>
  error instanceof EtsyError
    ? `Etsy said: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);

// Etsy answered and refused: the write did not run. Anything else (no
// answer, a server error) may have run.
const refusedByEtsy = (error: unknown) =>
  error instanceof EtsyError && error.status >= 400 && error.status < 500;

// The guard before every change: the listing, read from Etsy now, is a draft
// of the connected shop. Etsy's read by id is tried first, then the shop's
// drafts; a listing Kiln cannot confirm as a draft is refused.
export async function editableDraft(
  etsy: ConnectedEtsy,
  listingId: number,
): Promise<EtsyDraftListing> {
  let listing: EtsyDraftListing | undefined;
  try {
    listing = await etsy.drafts.listing(listingId);
  } catch (error) {
    if (!(error instanceof EtsyError) || error.status >= 500) throw error;
    const drafts = await allPages(
      (page) => etsy.drafts.drafts(etsy.shopId, page),
      MAX_DRAFT_PAGES,
    );
    listing = drafts.items.find((d) => d.listing_id === listingId);
  }
  if (!listing || listing.shop_id !== etsy.shopId) {
    throw new DraftRefusal(
      `Listing ${listingId} is not a draft of ${etsy.shopName}.`,
    );
  }
  if (listing.state !== "draft") {
    throw new DraftRefusal(
      `Listing ${listingId} is ${listing.state} on Etsy: Kiln changes drafts only.`,
    );
  }
  return listing;
}

// --- The log -----------------------------------------------------------------

type WriteAction =
  | "create"
  | "photos"
  | "edit"
  | "price"
  | "photo-add"
  | "photo-remove";

export interface ShopWriteView {
  id: string;
  action: WriteAction;
  by: string;
  status: "pending" | "done" | "failed" | "unanswered";
  error?: string;
  at: string;
  sent: Record<string, unknown>;
}

async function logWrite(data: {
  makerId: string;
  shopId: number;
  listingId?: number;
  action: WriteAction;
  by: DraftWriter;
  sent: Record<string, unknown>;
  status: ShopWriteView["status"];
  error?: string;
  requestKey?: string;
  projectId?: string;
  destinationId?: string;
  productId?: string;
}) {
  return db.shopWrite.create({
    data: {
      ...data,
      platform: PLATFORM,
      shopId: String(data.shopId),
      listingId: data.listingId === undefined ? null : String(data.listingId),
      sent: data.sent as Prisma.InputJsonValue,
    },
  });
}

const viewOf = (row: {
  id: string;
  action: string;
  by: string;
  status: string;
  error: string | null;
  at: Date;
  sent: Prisma.JsonValue;
}): ShopWriteView => ({
  id: row.id,
  action: row.action as WriteAction,
  by: row.by,
  status: row.status as ShopWriteView["status"],
  ...(row.error ? { error: row.error } : {}),
  at: row.at.toISOString(),
  sent: (row.sent ?? {}) as Record<string, unknown>,
});

export async function draftLog(listingId: number): Promise<ShopWriteView[]> {
  if (!hasDatabase()) return [];
  const maker = await getCurrentMaker();
  const rows = await db.shopWrite.findMany({
    where: { makerId: maker.id, listingId: String(listingId) },
    orderBy: { at: "desc" },
    take: 50,
  });
  return rows.map(viewOf);
}

// The drafts Kiln made from a project's destinations, newest first.
export async function projectDrafts(
  projectId: string,
): Promise<{ destinationId: string; listingId: number; at: string }[]> {
  if (!hasDatabase()) return [];
  const maker = await getCurrentMaker();
  const rows = await db.shopWrite.findMany({
    where: {
      makerId: maker.id,
      projectId,
      action: "create",
      status: "done",
      listingId: { not: null },
    },
    orderBy: { at: "desc" },
  });
  return rows.map((r) => ({
    destinationId: r.destinationId ?? "",
    listingId: Number(r.listingId),
    at: r.at.toISOString(),
  }));
}

// --- Reading -------------------------------------------------------------------

export interface DraftSummary {
  listingId: number;
  title: string;
  state: string;
  price: number;
  currency: string;
  quantity?: number;
  updatedAt?: string;
  photo?: string;
  photos: number;
  editorUrl: string;
  madeBy?: { projectId: string; projectName: string };
}

const summaryOf = (l: EtsyDraftListing): DraftSummary => ({
  listingId: l.listing_id,
  title: etsyText(l.title),
  state: l.state,
  price: moneyValue(l.price),
  currency: l.price.currency_code,
  ...(l.quantity !== undefined ? { quantity: l.quantity } : {}),
  ...(l.updated_timestamp
    ? { updatedAt: new Date(l.updated_timestamp * 1000).toISOString() }
    : {}),
  ...(l.images?.[0]?.url_570xN ? { photo: l.images[0].url_570xN } : {}),
  photos: l.images?.length ?? 0,
  editorUrl: etsyEditorUrl(l.listing_id),
});

export async function listDrafts(): Promise<{
  shopName: string;
  draftsAllowed: boolean;
  drafts: DraftSummary[];
  complete: boolean;
}> {
  const etsy = await shopOrRefuse();
  const { items, complete } = await allPages(
    (page) => etsy.drafts.drafts(etsy.shopId, page),
    MAX_DRAFT_PAGES,
  );
  const maker = await getCurrentMaker();
  const made = await db.shopWrite.findMany({
    where: {
      makerId: maker.id,
      action: "create",
      status: "done",
      listingId: { in: items.map((d) => String(d.listing_id)) },
    },
    select: { listingId: true, projectId: true },
  });
  const projects = await db.project.findMany({
    where: {
      makerId: maker.id,
      id: { in: made.flatMap((m) => (m.projectId ? [m.projectId] : [])) },
    },
    select: { id: true, name: true },
  });
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const by = new Map(made.map((m) => [m.listingId, m.projectId]));
  return {
    shopName: etsy.shopName,
    draftsAllowed: etsy.draftsAllowed,
    complete,
    drafts: items.map((l) => {
      const projectId = by.get(String(l.listing_id));
      const projectName = projectId ? nameOf.get(projectId) : undefined;
      return {
        ...summaryOf(l),
        ...(projectId && projectName
          ? { madeBy: { projectId, projectName } }
          : {}),
      };
    }),
  };
}

export interface DraftDetail extends DraftSummary {
  description: string;
  tags: string[];
  materials: string[];
  taxonomyId?: number;
  category?: string[];
  whoMade?: string;
  whenMade?: string;
  shippingProfileId?: number;
  readinessStateId?: number;
  images: { id: number; url: string; rank: number }[];
  // Kiln may change it now (a draft of the connected shop, writes allowed).
  editable: boolean;
  why?: string;
  // Its inventory holds more than one product: its prices stay Etsy's.
  variations: boolean;
  log: ShopWriteView[];
}

export async function draftDetail(listingId: number): Promise<DraftDetail> {
  const etsy = await shopOrRefuse();
  let listing: EtsyDraftListing;
  try {
    listing = await etsy.drafts.listing(listingId);
  } catch (error) {
    throw new DraftRefusal(said(error));
  }
  if (listing.shop_id !== etsy.shopId) {
    throw new DraftRefusal(`Listing ${listingId} is not in ${etsy.shopName}.`);
  }
  const isDraft = listing.state === "draft";
  const inventory = isDraft
    ? await etsy.drafts.inventory(listingId).catch(() => null)
    : null;
  const variations =
    (inventory?.products.filter((p) => !p.is_deleted).length ?? 0) > 1 ||
    listing.has_variations === true;
  const taxonomy = listing.taxonomy_id
    ? await etsy.drafts.taxonomy().catch(() => [] as TaxonomyChoice[])
    : [];
  const category = taxonomy.find((t) => t.id === listing.taxonomy_id)?.path;
  const why = !isDraft
    ? `This listing is ${listing.state} on Etsy: Kiln does not change it.`
    : !etsy.draftsAllowed
      ? "Connect the shop again to let Kiln write drafts."
      : undefined;
  return {
    ...summaryOf(listing),
    description: etsyText(listing.description),
    tags: listing.tags.map(etsyText),
    materials: listing.materials.map(etsyText),
    ...(listing.taxonomy_id ? { taxonomyId: listing.taxonomy_id } : {}),
    ...(category ? { category } : {}),
    ...(listing.who_made ? { whoMade: listing.who_made } : {}),
    ...(listing.when_made ? { whenMade: listing.when_made } : {}),
    ...(listing.shipping_profile_id
      ? { shippingProfileId: listing.shipping_profile_id }
      : {}),
    ...(listing.readiness_state_id
      ? { readinessStateId: listing.readiness_state_id }
      : {}),
    images: (listing.images ?? []).flatMap((i) =>
      i.listing_image_id && (i.url_570xN || i.url_fullxfull)
        ? [
            {
              id: i.listing_image_id,
              url: (i.url_570xN ?? i.url_fullxfull) as string,
              rank: i.rank ?? 0,
            },
          ]
        : [],
    ),
    editable: isDraft && etsy.draftsAllowed,
    ...(why ? { why } : {}),
    variations,
    log: await draftLog(listingId),
  };
}

// The categories and the shop's profiles a draft's form offers.
export async function draftChoices(): Promise<{
  categories: TaxonomyChoice[];
  shipping: { id: number; label: string }[];
  processing: { id: number; label: string }[];
}> {
  const etsy = await shopOrRefuse();
  const [categories, shipping, processing] = await Promise.all([
    etsy.drafts.taxonomy(),
    etsy.drafts.shippingProfiles(etsy.shopId).catch(() => []),
    etsy.drafts.processingProfiles(etsy.shopId).catch(() => []),
  ]);
  return { categories, shipping, processing };
}

// --- A draft from a project ----------------------------------------------------

// The draft's photos as the delivery numbers them, without rendering them:
// every frame switched on but the video, in the plan's order.
function plannedPhotos(
  plan: PlanDestination,
): (DraftPhoto & { thumb?: string })[] {
  let n = 0;
  return plan.slots
    .filter((s) => !s.off && s.fill !== "video" && !s.standalone)
    .map((s) => {
      n += 1;
      const thumb = s.fill === "photo" ? s.photo : s.approvedOutput;
      return {
        file: `${String(n).padStart(2, "0")}-${s.key}`,
        slot: s.key,
        label: s.label,
        width: 0,
        height: 0,
        ...(s.fill === "exact" ? {} : thumb ? { thumb } : {}),
      };
    });
}

// The project's photos only: the video is not sent, so it does not hold the
// draft back.
const photosOnly = (input: DeliveryInput): DeliveryInput => ({
  ...input,
  plan: {
    ...input.plan,
    slots: input.plan.slots.filter((s) => s.fill !== "video"),
  },
});

const mode = <T>(values: T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

// Kiln's first guess at what Etsy needs: what the last draft of this product
// used, else what the shop's live listings use most; a profile is picked
// when the shop has just one.
async function defaultSettings(
  etsy: ConnectedEtsy,
  makerId: string,
  productId: string,
  shipping: { id: number }[],
  processing: { id: number }[],
): Promise<DraftSettings> {
  const last = await db.shopWrite.findFirst({
    where: { makerId, productId, action: "create", status: "done" },
    orderBy: { at: "desc" },
  });
  const before = DraftSettings.safeParse(
    (last?.sent as { settings?: unknown } | null)?.settings ?? {},
  );
  if (last && before.success) return before.data;
  const live = await etsy.reader
    .activeListings(etsy.shopId, { limit: 100, offset: 0 })
    .then((p) => p.results)
    .catch(() => []);
  const taxonomyId = mode(
    live.flatMap((l) => (l.taxonomy_id ? [l.taxonomy_id] : [])),
  );
  const quantity = mode(
    live.flatMap((l) => (l.quantity && l.quantity > 0 ? [l.quantity] : [])),
  );
  return DraftSettings.parse({
    ...(taxonomyId ? { taxonomyId } : {}),
    quantity: quantity ?? 1,
    ...(shipping.length === 1 ? { shippingProfileId: shipping[0].id } : {}),
    ...(processing.length === 1 ? { readinessStateId: processing[0].id } : {}),
  });
}

export interface DraftPreview {
  shopName: string;
  draftsAllowed: boolean;
  currency?: string;
  projectName: string;
  productName: string;
  settings: DraftSettings;
  // The listing as it would be sent, shown even while a blocker stands.
  text: {
    title: string;
    description: string;
    tags: string[];
    materials: string[];
    price?: number;
  };
  fields: DraftFields | null;
  photos: (DraftPhoto & { thumb?: string })[];
  blockers: string[];
  notSent: string[];
  requestKey: string;
  // Drafts Kiln already made from this destination.
  made: { listingId: number; at: string }[];
}

export async function previewDraft(
  projectId: string,
  destinationId: string,
  chosen?: Partial<DraftSettings>,
): Promise<DraftPreview> {
  const etsy = await shopOrRefuse();
  const delivery = await destinationDelivery(projectId, destinationId);
  const listing = delivery?.input.listing;
  const rules = delivery?.input.destination.text;
  if (!delivery || !listing || !rules) {
    throw new DraftRefusal("This destination has no listing to draft.");
  }
  const maker = await getCurrentMaker();
  const choices = await draftChoices();
  const guessed = await defaultSettings(
    etsy,
    maker.id,
    delivery.product.id,
    choices.shipping,
    choices.processing,
  );
  const settings = DraftSettings.parse({ ...guessed, ...chosen });
  const plan = delivery.input.plan;
  const photos = plannedPhotos(plan);
  const notReady = deliveryBlockers(
    photosOnly(delivery.input).plan,
    delivery.input.cardOf,
  ).notReady;
  const proposal = draftProposal({
    product: delivery.product,
    listing,
    rules,
    photos,
    settings,
    hasVideo: plan.slots.some((s) => !s.off && s.fill === "video"),
  });
  const blockers = [
    ...(notReady.length > 0
      ? [`Approve every photo first: ${notReady.join(", ")}.`]
      : []),
    ...proposal.blockers,
  ];
  const shop = await etsy.reader.shop(etsy.shopId).catch(() => null);
  const made = (await projectDrafts(projectId))
    .filter((d) => d.destinationId === destinationId)
    .map(({ listingId, at }) => ({ listingId, at }));
  return {
    shopName: etsy.shopName,
    draftsAllowed: etsy.draftsAllowed,
    ...(shop?.currency_code ? { currency: shop.currency_code } : {}),
    projectName: delivery.input.projectName,
    productName: delivery.product.name,
    settings,
    text: {
      title: listing.title.value.trim(),
      description: listing.description.value.trim(),
      tags: listing.tags.value,
      materials: listing.materials.value,
      ...(delivery.product.price !== undefined
        ? { price: delivery.product.price }
        : {}),
    },
    fields: blockers.length === 0 ? proposal.fields : null,
    photos: proposal.photos as (DraftPhoto & { thumb?: string })[],
    blockers,
    notSent: proposal.notSent,
    requestKey: randomUUID(),
    made,
  };
}

export interface ReadBack {
  field: string;
  sent: string;
  onEtsy: string;
}

function readBack(
  sent: Partial<DraftFields> & { photos?: number },
  listing: EtsyDraftListing,
): ReadBack[] {
  const out: ReadBack[] = [];
  const check = (field: string, a: string | undefined, b: string) => {
    if (a !== undefined && a !== b) out.push({ field, sent: a, onEtsy: b });
  };
  check("title", sent.title, etsyText(listing.title));
  check("tags", sent.tags?.join(", "), listing.tags.map(etsyText).join(", "));
  check(
    "price",
    sent.price === undefined ? undefined : sent.price.toFixed(2),
    moneyValue(listing.price).toFixed(2),
  );
  check(
    "quantity",
    sent.quantity === undefined ? undefined : String(sent.quantity),
    String(listing.quantity ?? ""),
  );
  check(
    "photos",
    sent.photos === undefined ? undefined : String(sent.photos),
    String(listing.images?.length ?? 0),
  );
  return out;
}

export interface DraftMade {
  listingId: number;
  editorUrl: string;
  photos: number;
  missingPhotos: string[];
  readBack: ReadBack[];
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
};

export async function createDraftFromProject(input: {
  projectId: string;
  destinationId: string;
  settings: DraftSettings;
  requestKey: string;
  by: DraftWriter;
}): Promise<DraftMade> {
  const etsy = await writableShop();
  const maker = await getCurrentMaker();
  const delivery = await destinationDelivery(
    input.projectId,
    input.destinationId,
  );
  const listing = delivery?.input.listing;
  const rules = delivery?.input.destination.text;
  if (!delivery || !listing || !rules) {
    throw new DraftRefusal("This destination has no listing to draft.");
  }
  const delivered = photosOnly(delivery.input);
  const notReady = deliveryBlockers(delivered.plan, delivered.cardOf).notReady;
  if (notReady.length > 0) {
    throw new DraftRefusal(
      `Approve every photo first: ${notReady.join(", ")}.`,
    );
  }
  const proposal = draftProposal({
    product: delivery.product,
    listing,
    rules,
    photos: plannedPhotos(delivery.input.plan),
    settings: input.settings,
    hasVideo: false,
  });
  if (!proposal.fields) throw new DraftRefusal(proposal.blockers.join(" "));
  const fields = proposal.fields;
  // The key is claimed before Etsy is called: the same preview makes one
  // draft, however often it is sent.
  let row: { id: string };
  try {
    row = await logWrite({
      makerId: maker.id,
      shopId: etsy.shopId,
      action: "create",
      by: input.by,
      sent: { ...fields, settings: input.settings },
      status: "pending",
      requestKey: input.requestKey,
      projectId: input.projectId,
      destinationId: input.destinationId,
      productId: delivery.product.id,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DraftRefusal(
        "This draft was already sent: look for it in your drafts.",
      );
    }
    throw error;
  }
  const settle = (status: ShopWriteView["status"], extra: object = {}) =>
    db.shopWrite.update({ where: { id: row.id }, data: { status, ...extra } });
  let files: Awaited<ReturnType<typeof deliveredFiles>>;
  try {
    files = await deliveredFiles(delivered);
  } catch (error) {
    await settle("failed", { error: said(error) });
    if (error instanceof DeliveryRefusal) throw new DraftRefusal(error.message);
    throw error;
  }
  let made: EtsyDraftListing;
  try {
    made = await etsy.drafts.createDraft(etsy.shopId, fields);
  } catch (error) {
    if (refusedByEtsy(error)) {
      await settle("failed", { error: said(error) });
      throw new DraftRefusal(said(error));
    }
    await settle("unanswered", { error: said(error) });
    throw new DraftRefusal(
      "Etsy did not answer: look in your drafts before trying again.",
    );
  }
  await settle("done", { listingId: String(made.listing_id) });
  const photos = files.files
    .filter((f) => f.meta.kind !== "video" && f.meta.photo !== null)
    .slice(0, ETSY_MAX_PHOTOS);
  const missing = await uploadPhotos(etsy, made.listing_id, photos, 1);
  await logWrite({
    makerId: maker.id,
    shopId: etsy.shopId,
    listingId: made.listing_id,
    action: "photos",
    by: input.by,
    sent: {
      files: photos.map((f) => f.meta.file),
      ...(missing.length > 0 ? { missing } : {}),
    },
    status: missing.length === 0 ? "done" : "failed",
    ...(missing.length > 0
      ? { error: `${missing.length} photo(s) did not reach Etsy.` }
      : {}),
    projectId: input.projectId,
    destinationId: input.destinationId,
  });
  const after = await etsy.drafts.listing(made.listing_id).catch(() => made);
  return {
    listingId: made.listing_id,
    editorUrl: etsyEditorUrl(made.listing_id),
    photos: photos.length - missing.length,
    missingPhotos: missing,
    readBack: readBack(
      { ...fields, photos: photos.length - missing.length },
      after,
    ),
  };
}

// Each photo in order from `rank`; the files Etsy did not take.
async function uploadPhotos(
  etsy: ConnectedEtsy,
  listingId: number,
  photos: { meta: { file: string }; bytes: Uint8Array }[],
  rank: number,
): Promise<string[]> {
  const missing: string[] = [];
  let next = rank;
  for (const photo of photos) {
    const ext = photo.meta.file.split(".").pop() ?? "";
    try {
      await etsy.drafts.addPhoto(etsy.shopId, listingId, {
        bytes: photo.bytes,
        mime: MIME[ext] ?? "image/jpeg",
        filename: photo.meta.file,
        rank: next,
      });
      next += 1;
    } catch (error) {
      console.warn(`[kiln drafts] ${photo.meta.file} was not taken`, error);
      missing.push(photo.meta.file);
    }
  }
  return missing;
}

// The photos a draft made from a project did not get, sent again after the
// ones it has.
export async function sendMissingPhotos(
  listingId: number,
  by: DraftWriter,
): Promise<{ sent: number; missing: string[] }> {
  const etsy = await writableShop();
  const maker = await getCurrentMaker();
  const last = await db.shopWrite.findFirst({
    where: {
      makerId: maker.id,
      listingId: String(listingId),
      action: "photos",
    },
    orderBy: { at: "desc" },
  });
  const wanted = ((last?.sent as { missing?: string[] } | null)?.missing ??
    []) as string[];
  if (!last?.projectId || !last.destinationId || wanted.length === 0) {
    throw new DraftRefusal("This draft is missing no photo Kiln sent.");
  }
  const listing = await editableDraft(etsy, listingId);
  const delivery = await destinationDelivery(
    last.projectId,
    last.destinationId,
  );
  if (!delivery) throw new DraftRefusal("Its project is gone.");
  const files = await deliveredFiles(photosOnly(delivery.input));
  const photos = files.files.filter((f) => wanted.includes(f.meta.file));
  const missing = await uploadPhotos(
    etsy,
    listingId,
    photos,
    (listing.images?.length ?? 0) + 1,
  );
  await logWrite({
    makerId: maker.id,
    shopId: etsy.shopId,
    listingId,
    action: "photos",
    by,
    sent: {
      files: photos.map((f) => f.meta.file),
      ...(missing.length > 0 ? { missing } : {}),
    },
    status: missing.length === 0 ? "done" : "failed",
    projectId: last.projectId,
    destinationId: last.destinationId,
  });
  return { sent: photos.length - missing.length, missing };
}

// --- Changing a draft --------------------------------------------------------

export type DraftChange = DraftTextEdit & {
  price?: number;
  quantity?: number;
};

const TEXT_FIELDS = [
  "title",
  "description",
  "tags",
  "materials",
  "taxonomyId",
  "whoMade",
  "whenMade",
  "shippingProfileId",
  "readinessStateId",
] as const;

export async function updateDraft(
  listingId: number,
  change: DraftChange,
  by: DraftWriter,
): Promise<{ changes: FieldChange[]; readBack: ReadBack[] }> {
  const etsy = await writableShop();
  const maker = await getCurrentMaker();
  const listing = await editableDraft(etsy, listingId);
  const text: DraftTextEdit = Object.fromEntries(
    TEXT_FIELDS.flatMap((f) =>
      change[f] === undefined ? [] : [[f, change[f]]],
    ),
  );
  const prices = change.price !== undefined || change.quantity !== undefined;
  // Both checks before any write: a refused price leaves the text untouched.
  let inventory = null;
  if (prices) {
    const current = await etsy.drafts.inventory(listingId);
    inventory = singleOffering(current, {
      price: change.price ?? moneyValue(listing.price),
      quantity: change.quantity ?? listing.quantity ?? 1,
    });
    if (!inventory) {
      throw new DraftRefusal(
        "This draft has variations: change its prices and quantities in Etsy's editor.",
      );
    }
  }
  const before = {
    title: etsyText(listing.title),
    description: etsyText(listing.description),
    tags: listing.tags.map(etsyText),
    materials: listing.materials.map(etsyText),
    taxonomyId: listing.taxonomy_id ?? undefined,
    whoMade: listing.who_made ?? undefined,
    whenMade: listing.when_made ?? undefined,
    shippingProfileId: listing.shipping_profile_id ?? undefined,
    readinessStateId: listing.readiness_state_id ?? undefined,
    price: moneyValue(listing.price),
    quantity: listing.quantity,
  };
  const changes = draftChanges(before, { ...text, ...change });
  if (changes.length === 0) return { changes, readBack: [] };
  const write = async (
    action: WriteAction,
    sent: Record<string, unknown>,
    run: () => Promise<unknown>,
  ) => {
    try {
      await run();
      await logWrite({
        makerId: maker.id,
        shopId: etsy.shopId,
        listingId,
        action,
        by,
        sent,
        status: "done",
      });
    } catch (error) {
      await logWrite({
        makerId: maker.id,
        shopId: etsy.shopId,
        listingId,
        action,
        by,
        sent,
        status: refusedByEtsy(error) ? "failed" : "unanswered",
        error: said(error),
      });
      throw new DraftRefusal(said(error));
    }
  };
  // Only what differs is sent.
  const changed: DraftTextEdit = Object.fromEntries(
    Object.entries(text).filter(([f]) => changes.some((c) => c.field === f)),
  );
  if (Object.keys(changed).length > 0) {
    await write("edit", changed, () =>
      etsy.drafts.updateDraft(etsy.shopId, listingId, changed),
    );
  }
  if (
    inventory &&
    changes.some((c) => c.field === "price" || c.field === "quantity")
  ) {
    const body = inventory;
    await write(
      "price",
      { price: change.price, quantity: change.quantity },
      () => etsy.drafts.setInventory(listingId, body),
    );
  }
  const after = await etsy.drafts.listing(listingId);
  return {
    changes,
    readBack: readBack(
      {
        ...(text.title !== undefined ? { title: text.title } : {}),
        ...(text.tags !== undefined ? { tags: text.tags } : {}),
        ...(change.price !== undefined ? { price: change.price } : {}),
        ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
      },
      after,
    ),
  };
}

export async function addDraftPhoto(
  listingId: number,
  photo: { bytes: Uint8Array; mime: string; filename: string },
  by: DraftWriter,
): Promise<void> {
  const etsy = await writableShop();
  const maker = await getCurrentMaker();
  const listing = await editableDraft(etsy, listingId);
  const count = listing.images?.length ?? 0;
  if (count >= ETSY_MAX_PHOTOS) {
    throw new DraftRefusal(`Etsy takes ${ETSY_MAX_PHOTOS} photos at most.`);
  }
  const sent = { file: photo.filename, rank: count + 1 };
  try {
    await etsy.drafts.addPhoto(etsy.shopId, listingId, {
      ...photo,
      rank: count + 1,
    });
  } catch (error) {
    await logWrite({
      makerId: maker.id,
      shopId: etsy.shopId,
      listingId,
      action: "photo-add",
      by,
      sent,
      status: refusedByEtsy(error) ? "failed" : "unanswered",
      error: said(error),
    });
    throw new DraftRefusal(said(error));
  }
  await logWrite({
    makerId: maker.id,
    shopId: etsy.shopId,
    listingId,
    action: "photo-add",
    by,
    sent,
    status: "done",
  });
}

export async function removeDraftPhoto(
  listingId: number,
  imageId: number,
  by: DraftWriter,
): Promise<void> {
  const etsy = await writableShop();
  const maker = await getCurrentMaker();
  const listing = await editableDraft(etsy, listingId);
  if (!listing.images?.some((i) => i.listing_image_id === imageId)) {
    throw new DraftRefusal("That photo is not on this draft.");
  }
  const sent = { imageId };
  try {
    await etsy.drafts.removePhoto(etsy.shopId, listingId, imageId);
  } catch (error) {
    await logWrite({
      makerId: maker.id,
      shopId: etsy.shopId,
      listingId,
      action: "photo-remove",
      by,
      sent,
      status: refusedByEtsy(error) ? "failed" : "unanswered",
      error: said(error),
    });
    throw new DraftRefusal(said(error));
  }
  await logWrite({
    makerId: maker.id,
    shopId: etsy.shopId,
    listingId,
    action: "photo-remove",
    by,
    sent,
    status: "done",
  });
}

// The projects a draft can be made from: those with a destination that takes
// a listing through Etsy's draft API, newest first.
export async function draftableProjects(): Promise<
  {
    projectId: string;
    name: string;
    destinationId: string;
    updatedAt: string;
  }[]
> {
  if (!hasDatabase()) return [];
  const maker = await getCurrentMaker();
  const rows = await db.project.findMany({
    where: { makerId: maker.id, plan: { not: Prisma.DbNull } },
    select: { id: true, name: true, plan: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
  const drafted = new Set(
    CATALOG.destinations
      .filter((d) => d.delivery.mode === "draft-api" && d.text)
      .map((d) => d.id),
  );
  return rows.flatMap((row) => {
    const destinations =
      (row.plan as { destinations?: { destinationId?: string }[] } | null)
        ?.destinations ?? [];
    return destinations
      .filter((d) => d.destinationId && drafted.has(d.destinationId))
      .map((d) => ({
        projectId: row.id,
        name: row.name,
        destinationId: d.destinationId as string,
        updatedAt: row.updatedAt.toISOString(),
      }));
  });
}

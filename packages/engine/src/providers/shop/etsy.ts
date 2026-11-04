import { z } from "zod";

// Etsy Open API v3: the reads Kiln makes, over plain fetch. Every request
// carries the app's identity as `x-api-key: keystring:shared_secret`; a shop's
// private data (its receipts) also needs that shop's OAuth token
// (etsy-oauth.ts). Only the fields Kiln reads are kept; the rest of each answer
// is dropped. Checked against Etsy's OpenAPI spec on 2026-10-27.

export const ETSY_API = "https://api.etsy.com/v3/application";

export interface EtsyApp {
  keystring: string;
  sharedSecret: string;
}

export const etsyApiKey = (app: EtsyApp) =>
  `${app.keystring}:${app.sharedSecret}`;

const Id = z.number().int().positive();

export const EtsyMoney = z.object({
  amount: z.number().int(),
  divisor: z.number().int().min(0),
  currency_code: z.string(),
});
export type EtsyMoney = z.infer<typeof EtsyMoney>;

export const EtsySelf = z.object({ user_id: Id, shop_id: Id });
export type EtsySelf = z.infer<typeof EtsySelf>;

export const EtsyShop = z.object({
  shop_id: Id,
  shop_name: z.string(),
  url: z.string(),
  // Epoch seconds.
  create_date: z.number().int().optional(),
  currency_code: z.string().optional(),
  // Lifetime sales (transactions).
  transaction_sold_count: z.number().int().min(0).default(0),
  num_favorers: z.number().int().min(0).default(0),
  // Reviews of the shop's listings in the past year.
  review_count: z.number().int().min(0).nullable().optional(),
  review_average: z.number().nullable().optional(),
  listing_active_count: z.number().int().min(0).default(0),
  is_vacation: z.boolean().optional(),
  icon_url_fullxfull: z.string().nullable().optional(),
});
export type EtsyShop = z.infer<typeof EtsyShop>;

export const EtsyListing = z.object({
  listing_id: Id,
  shop_id: Id,
  title: z.string(),
  url: z.string(),
  state: z.string(),
  num_favorers: z.number().int().min(0).default(0),
  price: EtsyMoney,
  quantity: z.number().int().min(0).optional(),
  taxonomy_id: z.number().int().nullable().optional(),
  readiness_state_id: z.number().int().nullable().optional(),
  shipping_profile_id: z.number().int().nullable().optional(),
  // Older answers carried a daily tally of views; today's spec has none.
  views: z.number().int().min(0).optional(),
});
export type EtsyListing = z.infer<typeof EtsyListing>;

export const EtsyListingImage = z.object({
  listing_image_id: Id.optional(),
  rank: z.number().int().optional(),
  url_75x75: z.string().optional(),
  url_170x135: z.string().optional(),
  url_570xN: z.string().optional(),
  url_fullxfull: z.string().optional(),
  full_width: z.number().int().nullable().optional(),
  full_height: z.number().int().nullable().optional(),
});
export type EtsyListingImage = z.infer<typeof EtsyListingImage>;

// A listing read by id (the batch read), with its photos: whether it is still
// on Etsy, live, or private (made for one buyer).
export const EtsyListingDetail = EtsyListing.extend({
  is_private: z.boolean().optional(),
  images: z.array(EtsyListingImage).nullable().optional(),
});
export type EtsyListingDetail = z.infer<typeof EtsyListingDetail>;

export const EtsyTransaction = z.object({
  transaction_id: Id,
  listing_id: Id.nullable(),
  title: z.string().nullable().optional(),
  quantity: z.number().int().min(0),
  price: EtsyMoney,
});
export type EtsyTransaction = z.infer<typeof EtsyTransaction>;

export const EtsyReceipt = z.object({
  receipt_id: Id,
  status: z.string(),
  // Epoch seconds.
  created_timestamp: z.number().int(),
  transactions: z.array(EtsyTransaction).default([]),
});
export type EtsyReceipt = z.infer<typeof EtsyReceipt>;

const page = <T extends z.ZodType>(item: T) =>
  z.object({ count: z.number().int().min(0), results: z.array(item) });

export const EtsyShops = page(EtsyShop);
export const EtsyListings = page(EtsyListing);
export type EtsyListings = z.infer<typeof EtsyListings>;
export const EtsyReceipts = page(EtsyReceipt);
export type EtsyReceipts = z.infer<typeof EtsyReceipts>;
const EtsyListingDetails = page(EtsyListingDetail);

export const PAGE_LIMIT = 100;
// Etsy's batch read takes at most 100 ids.
export const BATCH_LIMIT = 100;

// What Kiln reads from Etsy: the live API, or the mock shop of a mock run.
export interface EtsyReader {
  // The connected user and their shop (needs the shop's token).
  me(): Promise<EtsySelf>;
  shop(shopId: number): Promise<EtsyShop>;
  findShops(name: string): Promise<EtsyShop[]>;
  activeListings(
    shopId: number,
    page: { limit: number; offset: number },
  ): Promise<EtsyListings>;
  // Listings by id, with their photos, up to BATCH_LIMIT at once. A listing
  // Etsy no longer has (or will not show) is missing from the answer.
  listings(listingIds: number[]): Promise<EtsyListingDetail[]>;
  // A shop's receipts created in a window, newest first (needs the shop's
  // token, scope transactions_r). Epoch seconds.
  receipts(
    shopId: number,
    query: {
      minCreated: number;
      maxCreated?: number;
      limit: number;
      offset: number;
    },
  ): Promise<EtsyReceipts>;
}

export class EtsyError extends Error {
  readonly name = "EtsyError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Etsy's own words for a failed request ({"error": "..."}), else its status.
function etsyWords(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: unknown;
      error_description?: unknown;
    };
    const said = parsed.error_description ?? parsed.error;
    if (typeof said === "string" && said.trim())
      return said.trim().slice(0, 300);
  } catch {}
  return `Etsy answered ${status}.`;
}

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EtsyFetchOptions {
  accessToken?: string;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

// One GET against the API: a 429 waits what Etsy asks (retry-after, at most
// 10 s) and tries again, twice at most; any other failure throws EtsyError
// with Etsy's words.
export async function etsyGet<T>(
  app: EtsyApp,
  path: string,
  query: Record<string, string | number | undefined>,
  schema: z.ZodType<T>,
  options: EtsyFetchOptions = {},
): Promise<T> {
  const url = new URL(`${ETSY_API}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const answer = await etsyRequest(app, url, { method: "GET" }, options);
  return readAnswer(answer, path, schema);
}

// A write's body: a form (Etsy's listing endpoints; a list goes as one
// comma-joined value, as Etsy's own examples send it), JSON (inventory) or
// multipart (a photo).
export type EtsyForm = Record<
  string,
  string | number | boolean | readonly (string | number)[] | undefined
>;
export type EtsyBody =
  | { form: EtsyForm }
  | { json: Record<string, unknown> }
  | { multipart: FormData };

export class EtsyGuard extends Error {
  readonly name = "EtsyGuard";
}

// Kiln never sets a listing's state: a draft set to active is published on
// etsy.com, so no body may carry one. And the only thing it removes is a
// photo of a listing: a listing itself is never deleted (Kiln does not even
// ask for the scope that would allow it).
function guard(method: string, path: string, body: EtsyBody | undefined) {
  const keys = !body
    ? []
    : "form" in body
      ? Object.keys(body.form)
      : "json" in body
        ? Object.keys(body.json)
        : [...body.multipart.keys()];
  if (keys.includes("state")) {
    throw new EtsyGuard(
      "Kiln never sets a listing's state: that would publish it.",
    );
  }
  if (method === "DELETE" && !/\/listings\/\d+\/images\/\d+$/.test(path)) {
    throw new EtsyGuard("Kiln deletes nothing on Etsy but a draft's photo.");
  }
}

function encoded(body: EtsyBody): {
  body: string | FormData;
  type?: string;
} {
  if ("json" in body) {
    return { body: JSON.stringify(body.json), type: "application/json" };
  }
  if ("multipart" in body) return { body: body.multipart };
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body.form)) {
    if (value === undefined) continue;
    form.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return {
    body: form.toString(),
    type: "application/x-www-form-urlencoded",
  };
}

// One write against the API (a shop's token is required). A 429 is retried
// as for a read: Etsy has not run the request. Nothing else is: a write with
// no answer may have run, and only the caller can tell. A 204 answers
// undefined; any other answer is read with `schema`.
export async function etsySend<T>(
  app: EtsyApp,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body: EtsyBody | undefined,
  schema: z.ZodType<T> | null,
  options: EtsyFetchOptions = {},
): Promise<T | undefined> {
  guard(method, path, body);
  if (!options.accessToken) {
    throw new EtsyGuard("Writing to a shop needs its token.");
  }
  const sent = body ? encoded(body) : undefined;
  const answer = await etsyRequest(
    app,
    new URL(`${ETSY_API}${path}`),
    {
      method,
      ...(sent ? { body: sent.body } : {}),
      ...(sent?.type ? { type: sent.type } : {}),
    },
    options,
  );
  if (answer.status === 204 || !schema) return undefined;
  return readAnswer(answer, path, schema);
}

async function etsyRequest(
  app: EtsyApp,
  url: URL,
  request: { method: string; body?: string | FormData; type?: string },
  options: EtsyFetchOptions,
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "x-api-key": etsyApiKey(app),
    accept: "application/json",
  };
  if (options.accessToken) {
    headers.authorization = `Bearer ${options.accessToken}`;
  }
  if (request.type) headers["content-type"] = request.type;
  const doFetch = options.fetch ?? fetch;
  const wait = options.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(url, {
      ...(request.method === "GET" ? {} : { method: request.method }),
      headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const after = Number(res.headers.get("retry-after"));
      await wait(
        Math.min(
          Number.isFinite(after) && after > 0 ? after * 1000 : 1000,
          MAX_WAIT_MS,
        ),
      );
      continue;
    }
    const body = await res.text();
    if (!res.ok) {
      throw new EtsyError(
        res.status,
        res.status === 429
          ? "Etsy is rate-limiting Kiln's requests — try again in a minute."
          : etsyWords(res.status, body),
      );
    }
    return { status: res.status, body };
  }
}

function readAnswer<T>(
  answer: { status: number; body: string },
  path: string,
  schema: z.ZodType<T>,
): T {
  let json: unknown;
  try {
    json = JSON.parse(answer.body);
  } catch {
    json = undefined;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new EtsyError(
      answer.status,
      `Etsy's answer to ${path} did not read as expected.`,
    );
  }
  return parsed.data;
}

// The live API as an EtsyReader. Without a token only the public reads work
// (a shop, its active listings, a search by name).
export function etsyApi(
  app: EtsyApp,
  options: EtsyFetchOptions = {},
): EtsyReader {
  const get = <T>(
    path: string,
    query: Record<string, string | number | undefined>,
    schema: z.ZodType<T>,
  ) => etsyGet(app, path, query, schema, options);
  return {
    me: () => get("/users/me", {}, EtsySelf),
    shop: (shopId) => get(`/shops/${shopId}`, {}, EtsyShop),
    findShops: async (name) =>
      (await get("/shops", { shop_name: name, limit: 10 }, EtsyShops)).results,
    activeListings: (shopId, { limit, offset }) =>
      get(`/shops/${shopId}/listings/active`, { limit, offset }, EtsyListings),
    listings: async (listingIds) =>
      listingIds.length === 0
        ? []
        : (
            await get(
              "/listings/batch",
              {
                listing_ids: listingIds.slice(0, BATCH_LIMIT).join(","),
                includes: "Images",
              },
              EtsyListingDetails,
            )
          ).results,
    receipts: (shopId, { minCreated, maxCreated, limit, offset }) =>
      get(
        `/shops/${shopId}/receipts`,
        {
          min_created: minCreated,
          max_created: maxCreated,
          sort_on: "created",
          sort_order: "desc",
          limit,
          offset,
        },
        EtsyReceipts,
      ),
  };
}

// Every page of a paged read, up to `maxPages`; `complete` is false when the
// cap cut it short.
export async function allPages<T>(
  read: (page: { limit: number; offset: number }) => Promise<{
    count: number;
    results: T[];
  }>,
  maxPages: number,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  for (let n = 0; n < maxPages; n++) {
    const { count, results } = await read({
      limit: PAGE_LIMIT,
      offset: n * PAGE_LIMIT,
    });
    items.push(...results);
    if (results.length < PAGE_LIMIT || items.length >= count) {
      return { items, complete: true };
    }
  }
  return { items, complete: false };
}

// A listing's address on Etsy.
export const etsyListingUrl = (listingId: number | string) =>
  `https://www.etsy.com/listing/${listingId}`;

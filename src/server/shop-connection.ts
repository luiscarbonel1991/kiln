import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assertDatabaseUrl, db, hasDatabase } from "@/lib/db";
import { env } from "@/lib/env";
import { storeAsset } from "@/providers/asset-bytes";
import { providerMode } from "@/providers/mode";
import {
  type EtsyApp,
  EtsyError,
  type EtsyReader,
  etsyApi,
} from "@/providers/shop/etsy";
import { type EtsyDraftWriter, etsyDrafts } from "@/providers/shop/etsy-drafts";
import { mockEtsyDrafts } from "@/providers/shop/etsy-drafts-mock";
import { MOCK_USER_ID, mockEtsy } from "@/providers/shop/etsy-mock";
import {
  callbackUrlProblem,
  connectUrl,
  draftsAllowed,
  ETSY_SCOPES,
  type EtsyTokens,
  exchangeCode,
  newState,
  pkcePair,
  refreshTokens,
} from "@/providers/shop/etsy-oauth";
import { getCurrentMaker } from "@/server/maker-repository";
import { seal, unseal } from "@/server/secret-box";

// The maker's Etsy shop, connected to Kiln (ROADMAP Phase 20, "The Etsy
// connection"; Luis, 2026-10-27: approve Kiln on Etsy, no key to paste). The
// maker clicks Connect, approves Kiln on Etsy's own page, and Etsy sends them
// back with a code that Kiln trades for the shop's tokens, kept sealed. The
// handshake (state and PKCE verifier) rides in a sealed, short-lived cookie,
// so the code is only taken from the browser that asked for it. A mock run
// connects a mock shop without leaving Kiln.

const PLATFORM = "etsy";
export const CONNECT_COOKIE = "kiln_etsy_connect";
export const CONNECT_PATH = "/api/shops/etsy";
// Etsy's own words when it refused a connection, for Shops to show once.
export const SHOPS_NOTE_COOKIE = "kiln_shops_note";
const CONNECT_TTL_MS = 10 * 60_000;
// An access token this close to expiring is refreshed first.
const REFRESH_AHEAD_MS = 2 * 60_000;

const ACCESS = "etsy-access";
const REFRESH = "etsy-refresh";
const HANDSHAKE = "etsy-connect";

export type ConnectProblem =
  | "not-set-up"
  | "expired"
  | "state"
  | "denied"
  | "etsy";

export class ConnectRefusal extends Error {
  readonly name = "ConnectRefusal";
  constructor(
    readonly problem: ConnectProblem,
    message: string,
  ) {
    super(message);
  }
}

export class ShopNeedsReconnect extends Error {
  readonly name = "ShopNeedsReconnect";
  constructor(shopName: string) {
    super(
      `Etsy no longer accepts Kiln's access to ${shopName}: connect it again.`,
    );
  }
}

// --- What this instance has to connect with -------------------------------

export interface EtsySetup {
  mode: "live" | "mock";
  // What is missing from .env before a shop can connect.
  missing: string[];
  redirectUri: string | null;
  // Whether other shops can be looked up (the app's keys alone suffice).
  publicReads: boolean;
}

function etsyApp(): EtsyApp | null {
  return env.ETSY_API_KEY && env.ETSY_SHARED_SECRET
    ? { keystring: env.ETSY_API_KEY, sharedSecret: env.ETSY_SHARED_SECRET }
    : null;
}

export function etsySetup(): EtsySetup {
  const mode = providerMode();
  const missing: string[] = [];
  if (mode === "live") {
    if (!env.ETSY_API_KEY) missing.push("ETSY_API_KEY");
    if (!env.ETSY_SHARED_SECRET) missing.push("ETSY_SHARED_SECRET");
    const problem = env.ETSY_REDIRECT_URI
      ? callbackUrlProblem(env.ETSY_REDIRECT_URI)
      : null;
    if (!env.ETSY_REDIRECT_URI) missing.push("ETSY_REDIRECT_URI");
    else if (problem) missing.push(`ETSY_REDIRECT_URI (${problem})`);
  }
  if (!env.KILN_SECRET_KEY) missing.push("KILN_SECRET_KEY");
  return {
    mode,
    missing,
    redirectUri: mode === "mock" ? null : (env.ETSY_REDIRECT_URI ?? null),
    publicReads: mode === "mock" || etsyApp() !== null,
  };
}

// Etsy's public reads (a shop, its listings, a search by name): the app's
// keys alone, no shop connected. Null until the keys are in .env.
export function publicEtsy(): EtsyReader | null {
  if (providerMode() === "mock") return mockEtsy();
  const app = etsyApp();
  return app ? etsyApi(app) : null;
}

// --- Connecting ------------------------------------------------------------

const Handshake = z.object({
  state: z.string().min(1),
  verifier: z.string().min(43),
  at: z.number(),
});

// Where to send the maker to approve Kiln, and the sealed handshake to keep
// in a cookie until Etsy sends them back.
export function beginConnect(now = Date.now()): {
  url: string;
  cookie: string;
} {
  const setup = etsySetup();
  if (setup.missing.length > 0) {
    throw new ConnectRefusal(
      "not-set-up",
      `Kiln is not set up to connect Etsy yet: add ${setup.missing.join(", ")} to .env and restart Kiln.`,
    );
  }
  const state = newState();
  const { verifier, challenge } = pkcePair();
  const cookie = seal(JSON.stringify({ state, verifier, at: now }), HANDSHAKE);
  const app = etsyApp();
  const url =
    setup.mode === "mock" || !app || !setup.redirectUri
      ? `${CONNECT_PATH}/callback?code=mock-code&state=${encodeURIComponent(state)}`
      : connectUrl({
          keystring: app.keystring,
          redirectUri: setup.redirectUri,
          state,
          challenge,
        });
  return { url, cookie };
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface ShopConnectionView {
  platform: "etsy";
  shopId: string;
  shopName: string;
  shopUrl: string;
  connectedAt: string;
  needsReconnect: boolean;
  // The maker approved Kiln to write drafts (listings_w); a shop connected
  // before drafts existed approves it by connecting again.
  draftsAllowed: boolean;
}

// Etsy sent the maker back: check the handshake, trade the code for the
// shop's tokens, read which shop they open, and keep them sealed.
export async function finishConnect(input: {
  code: string | null;
  state: string | null;
  error?: string | null;
  cookie: string | undefined;
  now?: number;
}): Promise<ShopConnectionView> {
  if (input.error) {
    throw new ConnectRefusal(
      "denied",
      input.error === "access_denied"
        ? "Etsy says the connection was not approved; nothing was kept."
        : `Etsy did not connect the shop (${input.error.slice(0, 80)}).`,
    );
  }
  const now = input.now ?? Date.now();
  let handshake: z.infer<typeof Handshake> | null = null;
  try {
    handshake = input.cookie
      ? Handshake.parse(JSON.parse(unseal(input.cookie, HANDSHAKE)))
      : null;
  } catch {
    handshake = null;
  }
  if (!handshake || now - handshake.at > CONNECT_TTL_MS) {
    throw new ConnectRefusal(
      "expired",
      "The connection took too long or started in another browser: connect again.",
    );
  }
  if (!input.state || !sameText(input.state, handshake.state) || !input.code) {
    throw new ConnectRefusal(
      "state",
      "Etsy's answer did not match the connection Kiln started: connect again.",
    );
  }
  const setup = etsySetup();
  let tokens: EtsyTokens;
  let reader: EtsyReader;
  try {
    const app = etsyApp();
    if (setup.mode === "mock" || !app || !setup.redirectUri) {
      tokens = {
        accessToken: `${MOCK_USER_ID}.mock-access`,
        refreshToken: `${MOCK_USER_ID}.mock-refresh`,
        expiresAt: new Date(now + 3600_000),
        userId: String(MOCK_USER_ID),
      };
      reader = mockEtsy();
    } else {
      tokens = await exchangeCode(
        app,
        {
          redirectUri: setup.redirectUri,
          code: input.code,
          verifier: handshake.verifier,
        },
        { now: () => new Date(now) },
      );
      reader = etsyApi(app, { accessToken: tokens.accessToken });
    }
    const me = await reader.me();
    const shop = await reader.shop(me.shop_id);
    return await keepConnection({
      tokens,
      shopId: String(shop.shop_id),
      shopName: shop.shop_name,
      shopUrl: shop.url,
    });
  } catch (error) {
    if (error instanceof EtsyError) {
      throw new ConnectRefusal("etsy", `Etsy said: ${error.message}`);
    }
    throw error;
  }
}

function view(row: {
  shopId: string;
  shopName: string;
  shopUrl: string;
  connectedAt: Date;
  needsReconnect: boolean;
  scopes: string;
}): ShopConnectionView {
  return {
    platform: PLATFORM,
    shopId: row.shopId,
    shopName: row.shopName,
    shopUrl: row.shopUrl,
    connectedAt: row.connectedAt.toISOString(),
    needsReconnect: row.needsReconnect,
    draftsAllowed: draftsAllowed(row.scopes),
  };
}

const VIEW = {
  shopId: true,
  shopName: true,
  shopUrl: true,
  connectedAt: true,
  needsReconnect: true,
  scopes: true,
} as const;

async function keepConnection(input: {
  tokens: EtsyTokens;
  shopId: string;
  shopName: string;
  shopUrl: string;
}): Promise<ShopConnectionView> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const sealed = {
    shopId: input.shopId,
    shopName: input.shopName,
    shopUrl: input.shopUrl,
    userId: input.tokens.userId,
    scopes: ETSY_SCOPES.join(" "),
    accessToken: seal(input.tokens.accessToken, ACCESS),
    refreshToken: seal(input.tokens.refreshToken, REFRESH),
    expiresAt: input.tokens.expiresAt,
    needsReconnect: false,
    connectedAt: new Date(),
    refreshedAt: null,
  };
  const row = await db.shopConnection.upsert({
    where: { makerId_platform: { makerId: maker.id, platform: PLATFORM } },
    create: { makerId: maker.id, platform: PLATFORM, ...sealed },
    update: sealed,
    select: VIEW,
  });
  return view(row);
}

// The maker's connected shop, without its tokens; null when none.
export async function shopConnection(): Promise<ShopConnectionView | null> {
  if (!hasDatabase()) return null;
  const maker = await getCurrentMaker();
  const row = await db.shopConnection.findUnique({
    where: { makerId_platform: { makerId: maker.id, platform: PLATFORM } },
    select: VIEW,
  });
  return row ? view(row) : null;
}

// Forget the shop: Kiln drops its tokens. The maker can also remove Kiln from
// their Etsy account's apps.
export async function disconnectShop(): Promise<boolean> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const { count } = await db.shopConnection.deleteMany({
    where: { makerId: maker.id, platform: PLATFORM },
  });
  return count > 0;
}

async function markNeedsReconnect(makerId: string): Promise<void> {
  await db.shopConnection.updateMany({
    where: { makerId, platform: PLATFORM },
    data: { needsReconnect: true },
  });
}

export interface ConnectedEtsy {
  reader: EtsyReader;
  // The shop's drafts; a write needs draftsAllowed (etsy-drafts.ts holds the
  // rules around every write).
  drafts: EtsyDraftWriter;
  draftsAllowed: boolean;
  shopId: number;
  shopName: string;
  shopUrl: string;
  // Etsy answered 401 for this token: Kiln's access was revoked.
  revoked(): Promise<void>;
}

// A reader acting for the connected shop, its access token refreshed first
// when it is about to expire (under the row's lock, so two requests never
// spend the same refresh token). Null when no shop is connected; throws
// ShopNeedsReconnect when Etsy no longer takes the refresh.
export async function connectedEtsy(
  options: { now?: Date; fetch?: typeof fetch } = {},
): Promise<ConnectedEtsy | null> {
  if (!hasDatabase()) return null;
  const maker = await getCurrentMaker();
  const where = {
    makerId_platform: { makerId: maker.id, platform: PLATFORM },
  };
  let row = await db.shopConnection.findUnique({ where });
  if (!row) return null;
  if (row.needsReconnect) throw new ShopNeedsReconnect(row.shopName);
  const now = options.now ?? new Date();
  const app = etsyApp();
  const live = providerMode() === "live";
  if (live && !app) {
    throw new ConnectRefusal(
      "not-set-up",
      "Kiln's Etsy app keys are gone from .env: add ETSY_API_KEY and ETSY_SHARED_SECRET back.",
    );
  }
  if (
    live &&
    app &&
    row.expiresAt.getTime() - now.getTime() < REFRESH_AHEAD_MS
  ) {
    const id = row.id;
    const shopName = row.shopName;
    row = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "ShopConnection" WHERE "id" = ${id} FOR UPDATE`;
        const locked = await tx.shopConnection.findUniqueOrThrow({
          where: { id },
        });
        // Another request refreshed it while this one waited.
        if (locked.expiresAt.getTime() - now.getTime() >= REFRESH_AHEAD_MS) {
          return locked;
        }
        let fresh: EtsyTokens;
        try {
          fresh = await refreshTokens(
            app,
            unseal(locked.refreshToken, REFRESH),
            { fetch: options.fetch, now: () => now },
          );
        } catch (error) {
          if (
            error instanceof EtsyError &&
            (error.status === 400 || error.status === 401)
          ) {
            await tx.shopConnection.update({
              where: { id },
              data: { needsReconnect: true },
            });
            return null;
          }
          throw error;
        }
        return tx.shopConnection.update({
          where: { id },
          data: {
            accessToken: seal(fresh.accessToken, ACCESS),
            refreshToken: seal(fresh.refreshToken, REFRESH),
            expiresAt: fresh.expiresAt,
            refreshedAt: now,
          },
        });
      },
      { timeout: 30_000 },
    );
    if (!row) throw new ShopNeedsReconnect(shopName);
  }
  const shop = row;
  const token =
    live && app
      ? { accessToken: unseal(shop.accessToken, ACCESS), fetch: options.fetch }
      : null;
  return {
    reader: app && token ? etsyApi(app, token) : mockEtsy(() => now),
    drafts:
      app && token
        ? etsyDrafts(app, token)
        : mockEtsyDrafts({
            now: () => now,
            keepPhoto: (bytes, mime) => storeAsset(bytes, mime, "mock-etsy"),
          }),
    draftsAllowed: draftsAllowed(shop.scopes),
    shopId: Number(shop.shopId),
    shopName: shop.shopName,
    shopUrl: shop.shopUrl,
    revoked: () => markNeedsReconnect(maker.id),
  };
}

// A cookie's value from a request's Cookie header.
export function cookieValue(
  header: string | null,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

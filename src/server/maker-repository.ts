import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { BrandKit } from "@/domain/brand";
import { type HeroSetting, heroKey } from "@/domain/hero-setting";
import {
  type MakerPreferences,
  readPreferences,
} from "@/domain/maker-preferences";
import { SearchColumns } from "@/domain/market-brief";
import {
  DEFAULT_MAKER_MODELS,
  type MakerModels,
  type ModelKind,
} from "@/domain/model-defaults";
import {
  AgentRoutes,
  MakerRoutes,
  ModelRole,
  ROLE_KIND,
  type Route,
  readMakerModels,
  routeEntry,
  routeHeads,
} from "@/domain/model-routing";
import {
  ListingId,
  MAX_LEFT_OUT,
  MAX_WATCHED_SHOPS,
  WatchedShop,
} from "@/domain/shop-ranking";
import { assertDatabaseUrl, db, hasDatabase } from "@/lib/db";
import { env } from "@/lib/env";
import { getAuth } from "@/server/auth";
import { type MemberRef, makerOfMember } from "@/server/organization";
import { bearerToken, hashToken } from "@/server/token-format";

export interface CurrentMaker {
  id: string;
  slug: string;
  name: string;
  // Who is working, when a person is (a session). A token, a script or the
  // worker has none.
  member?: MemberRef;
}

// The maker a piece of work is for, handed in by whoever knows it: the
// session or token behind a request, or a job's own maker in the worker;
// and, for a session, the person working, so what they start records them.
// An object rather than a bare id, so it cannot be passed where another id
// was meant.
export type MakerRef = Pick<CurrentMaker, "id" | "member">;

// Per-process cache of slug -> maker. The maker row is created once and never
// renamed by its slug, so the cache only saves one upsert per call.
const makers = new Map<string, CurrentMaker>();

// The headers of the request being served, or null when no request is: the
// generation worker, a script, a test.
async function requestHeaders(): Promise<Headers | null> {
  try {
    return await headers();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("outside a request scope")
    ) {
      return null;
    }
    throw error;
  }
}

// What a request says about who it acts for. A personal access token names
// its own maker; any other request needs a session, and works for the
// organization its person belongs to.
type RequestMaker =
  | { maker: CurrentMaker }
  | { refused: "token" | "session" | "organization" };

// Takes no maker: this is how the edge learns which maker a token names.
async function makerOfToken(token: string): Promise<CurrentMaker | null> {
  const row = await db.accessToken.findUnique({
    where: { hash: hashToken(token) },
    select: { maker: { select: { id: true, slug: true, name: true } } },
  });
  return row?.maker ?? null;
}

const requestMaker = cache(async (): Promise<RequestMaker | null> => {
  const h = await requestHeaders();
  if (!h) return null;
  const token = bearerToken(h.get("authorization"));
  if (token) {
    const maker = await makerOfToken(token);
    return maker ? { maker } : { refused: "token" };
  }
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return { refused: "session" };
  const maker = await makerOfMember({
    userId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId,
  });
  return maker ? { maker } : { refused: "organization" };
});

// The maker behind the request being served, or null when it carries no
// session and no valid token. For route handlers, which answer 401 themselves.
export async function getRequestMaker(): Promise<CurrentMaker | null> {
  assertDatabaseUrl();
  const found = await requestMaker();
  return found && "maker" in found ? found.maker : null;
}

// The maker the caller works for, resolved once at the edge (requireMaker in
// the guarded shapes) and handed down as a parameter from there: nothing
// below looks it up again. While a request is served, the maker behind its
// session or its access token (without either, the person goes to the
// sign-in page). With no request (a script, a test), the instance's own maker (env
// KILN_MAKER, default "default"), upserted on its unique slug so concurrent
// first calls cannot create two. The worker never asks: a job carries its
// maker.
export async function getCurrentMaker(): Promise<CurrentMaker> {
  assertDatabaseUrl();
  const found = await requestMaker();
  if (found) {
    if ("maker" in found) return found.maker;
    if (found.refused === "token") {
      throw new Error("That access token is not valid here.");
    }
    redirect(found.refused === "session" ? "/sign-in" : "/sign-in?left=1");
  }
  const slug = env.KILN_MAKER;
  const cached = makers.get(slug);
  if (cached) return cached;
  const maker = await db.maker.upsert({
    where: { slug },
    create: { slug, name: slug === "default" ? "My studio" : slug },
    update: {},
    select: { id: true, slug: true, name: true },
  });
  makers.set(slug, maker);
  return maker;
}

// The maker's brand kit, or null when none was imported or the stored blob no
// longer matches the schema (hardened on read: a stale row never throws).
export async function getMakerBrand(maker: MakerRef): Promise<BrandKit | null> {
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { brand: true },
  });
  const parsed = BrandKit.safeParse(row?.brand);
  return row?.brand && parsed.success ? parsed.data : null;
}

export async function saveMakerBrand(
  maker: MakerRef,
  brand: BrandKit,
): Promise<void> {
  await db.maker.update({
    where: { id: maker.id },
    data: { brand: brand as unknown as Prisma.InputJsonValue },
  });
}

// The maker's default model per kind, routes per role and the agents' own
// routes (Settings → Models), read leniently: a kind never saved, or saved on
// a model Kiln no longer offers, reads as Kiln's default; with routes saved,
// the defaults are their heads. Without a database (tests, demos) Kiln's
// defaults, no routes.
export async function getMakerModelSetup(maker: MakerRef): Promise<{
  models: MakerModels;
  routes: MakerRoutes | null;
  agents: AgentRoutes;
}> {
  if (!hasDatabase()) {
    return { models: DEFAULT_MAKER_MODELS, routes: null, agents: {} };
  }
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { models: true },
  });
  return readMakerModels(row?.models);
}

export async function getMakerModels(maker: MakerRef): Promise<MakerModels> {
  return (await getMakerModelSetup(maker)).models;
}

export async function getMakerRoutes(
  maker: MakerRef,
): Promise<MakerRoutes | null> {
  return (await getMakerModelSetup(maker)).routes;
}

// The maker's remembered choices (hero-setting.ts); none without a database.
export async function getMakerPreferences(
  maker: MakerRef,
): Promise<MakerPreferences> {
  if (!hasDatabase()) {
    return {
      heroSetting: {},
      searchColumns: {},
      watchedShops: [],
      leftOutListings: [],
      sceneLook: true,
    };
  }
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { preferences: true },
  });
  return readPreferences(row?.preferences);
}

// Change one kind of remembered choice under the maker's row lock, so two
// writes at once both land; every other key stays as it is. `update` returns
// null when nothing changes.
async function updatePreferences(
  maker: MakerRef,
  update: (
    kept: MakerPreferences,
  ) => Partial<Record<keyof MakerPreferences, unknown>> | null,
): Promise<void> {
  assertDatabaseUrl();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "Maker" WHERE "id" = ${maker.id} FOR UPDATE`;
    const row = await tx.maker.findUniqueOrThrow({
      where: { id: maker.id },
      select: { preferences: true },
    });
    const changed = update(readPreferences(row.preferences));
    if (!changed) return;
    const raw =
      row.preferences && typeof row.preferences === "object"
        ? (row.preferences as Record<string, unknown>)
        : {};
    await tx.maker.update({
      where: { id: maker.id },
      data: { preferences: { ...raw, ...changed } as Prisma.InputJsonValue },
    });
  });
}

// Settings → Checks: whether every scene is looked at once it lands.
export async function setSceneLook(
  maker: MakerRef,
  on: boolean,
): Promise<void> {
  await updatePreferences(maker, (kept) =>
    kept.sceneLook === on ? null : { sceneLook: on },
  );
}

// Remember the hero's setting for a destination and a product family.
export async function rememberHeroSetting(
  maker: MakerRef,
  destinationId: string,
  family: string,
  setting: HeroSetting,
): Promise<void> {
  const key = heroKey(destinationId, family);
  await updatePreferences(maker, (kept) =>
    kept.heroSetting[key] === setting
      ? null
      : { heroSetting: { ...kept.heroSetting, [key]: setting } },
  );
}

// Remember which header holds each value of a source's search table, so its
// next export is read without asking.
export async function rememberSearchColumns(
  maker: MakerRef,
  source: string,
  columns: SearchColumns,
): Promise<void> {
  const name = source.trim();
  const mapping = SearchColumns.parse(columns);
  if (!name) return;
  await updatePreferences(maker, (kept) =>
    JSON.stringify(kept.searchColumns[name]) === JSON.stringify(mapping)
      ? null
      : { searchColumns: { ...kept.searchColumns, [name]: mapping } },
  );
}

// Add a shop to the ones the maker compares theirs with (Shops), or take
// one off; false when it was already there (or not there), or the list is
// full.
export async function watchShop(
  maker: MakerRef,
  shop: WatchedShop,
): Promise<boolean> {
  const wanted = WatchedShop.parse(shop);
  let added = false;
  await updatePreferences(maker, (kept) => {
    if (
      kept.watchedShops.some((s) => s.shopId === wanted.shopId) ||
      kept.watchedShops.length >= MAX_WATCHED_SHOPS
    ) {
      return null;
    }
    added = true;
    return { watchedShops: [...kept.watchedShops, wanted] };
  });
  return added;
}

export async function unwatchShop(
  maker: MakerRef,
  shopId: string,
): Promise<boolean> {
  let removed = false;
  await updatePreferences(maker, (kept) => {
    const rest = kept.watchedShops.filter((s) => s.shopId !== shopId);
    if (rest.length === kept.watchedShops.length) return null;
    removed = true;
    return { watchedShops: rest };
  });
  return removed;
}

// Leave a listing of the maker's shop out of their best sellers, or put it
// back; false when nothing changed.
export async function leaveOutListing(
  maker: MakerRef,
  listingId: string,
  out: boolean,
): Promise<boolean> {
  const id = ListingId.parse(listingId);
  let changed = false;
  await updatePreferences(maker, (kept) => {
    const has = kept.leftOutListings.includes(id);
    if (has === out || (out && kept.leftOutListings.length >= MAX_LEFT_OUT)) {
      return null;
    }
    changed = true;
    return {
      leftOutListings: out
        ? [...kept.leftOutListings, id]
        : kept.leftOutListings.filter((l) => l !== id),
    };
  });
  return changed;
}

// Save the routes and the agents' own routes: every model one Kiln offers
// for the route's kind, with a pinned price, once per route (MakerRoutes,
// AgentRoutes), and a text route's effort. The heads are saved as the
// defaults in the same write, so a default and a route never disagree.
export async function saveMakerRoutes(
  maker: MakerRef,
  input: MakerRoutes,
  agentsInput: AgentRoutes = {},
): Promise<void> {
  const parsed = MakerRoutes.parse(input);
  const kept = (route: Route, kind: ModelKind): Route => ({
    models: route.models.map((m) => routeEntry(m, kind)),
    fallback: route.fallback,
    ...(kind === "text" && route.effort ? { effort: route.effort } : {}),
  });
  const routes = Object.fromEntries(
    ModelRole.options.map((role) => [
      role,
      kept(parsed[role], ROLE_KIND[role]),
    ]),
  ) as MakerRoutes;
  const agents = Object.fromEntries(
    Object.entries(AgentRoutes.parse(agentsInput)).map(([id, route]) => [
      id,
      kept(route, "text"),
    ]),
  );
  await db.maker.update({
    where: { id: maker.id },
    data: {
      models: {
        ...routeHeads(routes),
        routes,
        agents,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

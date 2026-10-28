"use client";

import {
  ChevronDown,
  ExternalLink,
  Heart,
  Loader2,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  findShopsAction,
  shopFavouritesAction,
  unwatchShopAction,
  watchShopAction,
} from "@/app/actions/shops";
import { Button } from "@/components/ui/button";
import {
  type FavouredListing,
  moneyLabel,
  type ShopRankBy,
  type ShopStanding,
} from "@/domain/shop-ranking";

const FIELD =
  "h-8 w-full min-w-0 rounded-field border border-border bg-secondary px-3 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";

const LABEL =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";

const ROW_GRID =
  "grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[40px_minmax(0,1fr)_8.5rem_6.5rem_9rem] sm:gap-x-4";

const count = (n: number) => n.toLocaleString("en-US");
const since = (s: ShopStanding) =>
  s.openedOn ? `since ${s.openedOn.slice(0, 4)}` : null;

function reviewsLabel(s: ShopStanding): string {
  if (!s.reviews || s.reviews.count === 0) return "–";
  return count(s.reviews.count);
}

function ShopAvatar({
  shop,
  size = 40,
}: {
  shop: ShopStanding;
  size?: number;
}) {
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-pill bg-surface-soft font-serif text-base italic text-on-surface-mid shadow-[0_3px_10px_-4px_rgba(50,32,18,0.25)]"
      style={{ width: size, height: size }}
    >
      {shop.icon ? (
        // biome-ignore lint/performance/noImgElement: Etsy's own image address, shown as Etsy serves it
        <img
          src={shop.icon}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        shop.name.charAt(0)
      )}
    </span>
  );
}

// Shops → other shops: the shops the maker compares theirs with, theirs among
// them, by the past year (reviews, Etsy's one recent number about another
// shop) or lifetime sales; each shop's listings by favourites on a click.
// Found by name; at most twelve.
export function OtherShops({
  standings,
  failed,
  yourShopId,
  by,
}: {
  standings: ShopStanding[];
  failed: { shopId: string; name: string; message: string }[];
  yourShopId: string | null;
  by: ShopRankBy;
}) {
  const [name, setName] = useState("");
  const [found, setFound] = useState<ShopStanding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [listings, setListings] = useState<
    Record<string, { listings: FavouredListing[]; read: number } | string>
  >({});
  const [pending, startTransition] = useTransition();
  const watched = new Set([
    ...standings.map((s) => s.shopId),
    ...failed.map((f) => f.shopId),
  ]);
  const others = standings.filter((s) => s.shopId !== yourShopId).length;

  const find = () =>
    startTransition(async () => {
      setError(null);
      const result = await findShopsAction(name);
      if ("error" in result) {
        setError(result.error);
        setFound(null);
        return;
      }
      setFound(result.shops);
    });

  const watch = (shop: ShopStanding) =>
    startTransition(async () => {
      const result = await watchShopAction({
        shopId: shop.shopId,
        name: shop.name,
      });
      setError(result.error ?? null);
      if (!result.error) {
        setFound(null);
        setName("");
      }
    });

  const unwatch = (shopId: string) =>
    startTransition(async () => {
      const result = await unwatchShopAction(shopId);
      setError(result.error ?? null);
      if (open === shopId) setOpen(null);
    });

  const toggle = (shopId: string) => {
    if (open === shopId) {
      setOpen(null);
      return;
    }
    setOpen(shopId);
    if (listings[shopId]) return;
    startTransition(async () => {
      const result = await shopFavouritesAction(shopId);
      setListings((all) => ({
        ...all,
        [shopId]: "error" in result ? result.error : result,
      }));
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
      >
        <label className="sr-only" htmlFor="shop-name">
          Shop name
        </label>
        <input
          id="shop-name"
          data-testid="shop-find-name"
          className={FIELD}
          placeholder="Find a shop by its name on Etsy"
          value={name}
          maxLength={80}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          data-testid="shop-find"
          disabled={pending || name.trim().length < 2}
        >
          {pending && found === null && name.trim().length >= 2 ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Search />
          )}
          Find
        </Button>
      </form>

      {error ? (
        <p className="font-mono text-[0.65rem] text-prov-local" role="alert">
          {error}
        </p>
      ) : null}

      {found ? (
        <div
          className="flex flex-col divide-y divide-border-soft rounded-render border border-border-soft bg-surface-soft"
          data-testid="shop-found"
        >
          <div className="flex items-center justify-between px-4 py-2">
            <span className={LABEL}>Shops Etsy found</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Close the shops found"
              onClick={() => setFound(null)}
            >
              <X />
            </Button>
          </div>
          {found.length === 0 ? (
            <span className="px-4 py-3 font-sans text-[0.8rem] text-on-surface-mid">
              Etsy has no open shop by that name.
            </span>
          ) : (
            found.map((s) => (
              <div
                key={s.shopId}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <ShopAvatar shop={s} size={32} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-sans text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                    {s.name}
                  </span>
                  <span className="font-sans text-[0.72rem] text-on-surface-mid">
                    {[
                      `${count(s.sold)} sales`,
                      since(s),
                      s.reviews?.count
                        ? `${count(s.reviews.count)} reviews in the past year`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`shop-watch-${s.shopId}`}
                  aria-label={`Compare with ${s.name}`}
                  disabled={pending || watched.has(s.shopId)}
                  onClick={() => watch(s)}
                >
                  <Plus />{" "}
                  {s.shopId === yourShopId
                    ? "Yours"
                    : watched.has(s.shopId)
                      ? "On the list"
                      : "Compare"}
                </Button>
              </div>
            ))
          )}
        </div>
      ) : null}

      {standings.length === 0 && failed.length === 0 ? (
        <p className="font-sans text-[0.8rem] text-on-surface-mid">
          No shops yet: find one by its name to compare yours with.
        </p>
      ) : (
        <div className="overflow-hidden rounded-render border border-border-soft bg-card">
          <div
            aria-hidden="true"
            className={`${ROW_GRID} hidden border-border-soft border-b bg-surface-soft px-4 py-2 sm:grid`}
          >
            <span />
            <span className={LABEL}>Shop</span>
            <span
              className={`${LABEL} text-right ${by === "recent" ? "text-foreground" : ""}`}
            >
              Reviews, past year
            </span>
            <span
              className={`${LABEL} text-right ${by === "lifetime" ? "text-foreground" : ""}`}
            >
              Sales, lifetime
            </span>
            <span />
          </div>
          <ol
            className="divide-y divide-border-soft"
            data-testid="watched-shops"
          >
            {standings.map((s) => {
              const shown = listings[s.shopId];
              const yours = s.shopId === yourShopId;
              return (
                <li
                  key={s.shopId}
                  className={`flex flex-col gap-3 px-3 py-3 sm:px-4 ${yours ? "bg-prov-recipe/[0.04]" : ""}`}
                  data-testid={`watched-shop-${s.shopId}`}
                >
                  <div className={ROW_GRID}>
                    <ShopAvatar shop={s} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group/name inline-flex min-w-0 items-center gap-1 font-sans text-[0.84rem] font-semibold text-foreground hover:text-primary"
                        >
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {s.name}
                          </span>
                          <ExternalLink className="size-3 flex-shrink-0 text-on-surface-dim group-hover/name:text-primary" />
                        </a>
                        {yours ? (
                          <span className="rounded-badge bg-prov-recipe/10 px-1.5 py-px font-mono text-[0.6rem] text-prov-recipe">
                            your shop
                          </span>
                        ) : null}
                        {s.onVacation ? (
                          <span className="rounded-badge bg-prov-brand/10 px-1.5 py-px font-mono text-[0.6rem] text-prov-brand">
                            on vacation
                          </span>
                        ) : null}
                      </span>
                      <span className="font-sans text-[0.72rem] text-on-surface-mid">
                        <span className="sm:hidden">
                          <span
                            className={
                              by === "recent"
                                ? "font-semibold text-foreground"
                                : undefined
                            }
                          >
                            {reviewsLabel(s)} reviews
                          </span>{" "}
                          in the past year ·{" "}
                          <span
                            className={
                              by === "lifetime"
                                ? "font-semibold text-foreground"
                                : undefined
                            }
                          >
                            {count(s.sold)} sales
                          </span>{" "}
                          ·{" "}
                        </span>
                        {[
                          since(s),
                          `${count(s.activeListings)} listings`,
                          `${count(s.favourites)} favourites`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <span
                      className={`hidden items-center justify-end gap-1 text-right font-sans text-[0.84rem] tabular-nums sm:flex ${
                        by === "recent"
                          ? "font-semibold text-foreground"
                          : "text-on-surface-mid"
                      }`}
                    >
                      {reviewsLabel(s)}
                      {s.reviews?.average ? (
                        <span className="inline-flex items-center gap-0.5 font-normal text-[0.7rem] text-on-surface-mid">
                          <Star className="size-3 fill-prov-brand text-prov-brand" />
                          {s.reviews.average.toFixed(1)}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`hidden text-right font-sans text-[0.84rem] tabular-nums sm:block ${
                        by === "lifetime"
                          ? "font-semibold text-foreground"
                          : "text-on-surface-mid"
                      }`}
                    >
                      {count(s.sold)}
                    </span>
                    <div className="col-start-2 flex items-center gap-1 sm:col-start-auto sm:justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`watched-shop-${s.shopId}-listings`}
                        aria-expanded={open === s.shopId}
                        aria-label={`${open === s.shopId ? "Hide" : "Show"} ${s.name}'s most favoured listings`}
                        onClick={() => toggle(s.shopId)}
                      >
                        <ChevronDown
                          className={`transition-transform ${open === s.shopId ? "rotate-180" : ""}`}
                        />
                        Top listings
                      </Button>
                      {yours ? (
                        <span className="size-7" />
                      ) : (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          data-testid={`watched-shop-${s.shopId}-remove`}
                          aria-label={`Take ${s.name} off the list`}
                          className="text-on-surface-dim hover:text-foreground"
                          disabled={pending}
                          onClick={() => unwatch(s.shopId)}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  </div>
                  {open === s.shopId ? (
                    <div
                      className="flex flex-col gap-3 rounded-render bg-surface-soft p-3 sm:ml-14"
                      data-testid={`watched-shop-${s.shopId}-favoured`}
                    >
                      <span className="font-sans text-[0.72rem] text-on-surface-mid">
                        Most favoured first: Etsy gives another shop&apos;s
                        sales only as a lifetime total, never per listing.
                      </span>
                      {shown === undefined ? (
                        <Loader2 className="size-4 animate-spin text-on-surface-dim" />
                      ) : typeof shown === "string" ? (
                        <span className="font-mono text-[0.65rem] text-prov-local">
                          {shown}
                        </span>
                      ) : (
                        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                          {shown.listings.map((l, n) => (
                            <li key={l.listingId} className="min-w-0">
                              <a
                                href={l.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group/listing flex min-w-0 flex-col gap-1.5"
                              >
                                <span className="relative block aspect-[170/135] overflow-hidden rounded-thumb bg-card shadow-[0_4px_12px_-4px_rgba(50,32,18,0.22)]">
                                  {l.photo ? (
                                    // biome-ignore lint/performance/noImgElement: Etsy's own image address, shown as Etsy serves it
                                    <img
                                      src={l.photo}
                                      alt=""
                                      loading="lazy"
                                      className="size-full object-cover transition-transform group-hover/listing:scale-[1.03]"
                                    />
                                  ) : null}
                                  <span className="absolute top-1.5 left-1.5 flex h-5 min-w-5 items-center justify-center rounded-pill bg-card/90 px-1 font-mono text-[0.6rem] text-foreground">
                                    {n + 1}
                                  </span>
                                </span>
                                <span className="line-clamp-2 font-sans text-[0.72rem] font-semibold leading-snug text-foreground [overflow-wrap:anywhere] group-hover/listing:text-primary">
                                  {l.title}
                                </span>
                                <span className="inline-flex items-center gap-1 font-sans text-[0.68rem] text-on-surface-mid">
                                  <Heart className="size-3" />
                                  {count(l.favourites)} ·{" "}
                                  {moneyLabel(l.price, l.currency)}
                                </span>
                              </a>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
            {failed.map((f) => (
              <li
                key={f.shopId}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0 font-sans text-[0.8rem] text-on-surface-mid [overflow-wrap:anywhere]">
                  <span className="font-semibold text-foreground">
                    {f.name}
                  </span>{" "}
                  — {f.message}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Take ${f.name} off the list`}
                  disabled={pending}
                  onClick={() => unwatch(f.shopId)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {others === 0 && standings.length > 0 ? (
        <p className="font-sans text-[0.75rem] text-on-surface-mid">
          Find a shop by its name to set it beside yours.
        </p>
      ) : null}
    </div>
  );
}

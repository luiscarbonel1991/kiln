"use client";

import {
  ChevronDown,
  ExternalLink,
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
  type ShopStanding,
} from "@/domain/shop-ranking";

const FIELD =
  "h-8 w-full min-w-0 rounded-field border border-border bg-secondary px-3 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";

const count = (n: number) => n.toLocaleString("en-US");

function standingLine(s: ShopStanding): string {
  const parts = [`${count(s.sold)} sales`];
  if (s.perMonth !== null && s.openedOn) {
    parts.push(
      `about ${count(s.perMonth)} a month since ${s.openedOn.slice(0, 4)}`,
    );
  }
  return parts.join(" · ");
}

function detailLine(s: ShopStanding): string {
  const parts: string[] = [];
  if (s.reviews && s.reviews.count > 0) {
    parts.push(
      `${s.reviews.average?.toFixed(1) ?? "–"} from ${count(s.reviews.count)} reviews this year`,
    );
  }
  parts.push(`${count(s.favourites)} favourites`);
  parts.push(`${count(s.activeListings)} listings`);
  if (s.onVacation) parts.push("on vacation");
  return parts.join(" · ");
}

// Shops → other shops: the shops the maker compares theirs with, by lifetime
// sales (Etsy's public numbers), each with its listings by favourites on a
// click. Found by name; at most twelve.
export function OtherShops({
  standings,
  failed,
}: {
  standings: ShopStanding[];
  failed: { shopId: string; name: string; message: string }[];
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
          placeholder="A shop's name on Etsy, e.g. NorthPineGoods"
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
          {pending && found === null ? (
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
          className="flex flex-col gap-2 rounded-render border border-border-soft bg-surface-soft p-3"
          data-testid="shop-found"
        >
          {found.length === 0 ? (
            <span className="font-sans text-[0.8rem] text-on-surface-mid">
              Etsy has no open shop by that name.
            </span>
          ) : (
            found.map((s) => (
              <div
                key={s.shopId}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-sans text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                    {s.name}
                  </span>
                  <span className="font-sans text-[0.75rem] text-on-surface-mid">
                    {standingLine(s)}
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
                  <Plus /> {watched.has(s.shopId) ? "On the list" : "Compare"}
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
        <ol
          className="flex flex-col divide-y divide-border-soft rounded-render border border-border-soft bg-surface-soft"
          data-testid="watched-shops"
        >
          {standings.map((s, i) => {
            const shown = listings[s.shopId];
            return (
              <li
                key={s.shopId}
                className="flex flex-col gap-2 px-4 py-3"
                data-testid={`watched-shop-${s.shopId}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-6 flex-shrink-0 font-mono text-[0.75rem] text-on-surface-dim">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-sans text-sm font-semibold text-foreground hover:text-primary"
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {s.name}
                      </span>
                      <ExternalLink className="size-3 flex-shrink-0 text-on-surface-dim" />
                    </a>
                    <span className="font-sans text-[0.75rem] font-semibold text-foreground">
                      {standingLine(s)}
                    </span>
                    <span className="inline-flex items-center gap-1 font-sans text-[0.75rem] text-on-surface-mid">
                      <Star className="size-3" /> {detailLine(s)}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`watched-shop-${s.shopId}-listings`}
                      aria-expanded={open === s.shopId}
                      aria-label={`${open === s.shopId ? "Hide" : "Show"} ${s.name}'s most favoured listings`}
                      onClick={() => toggle(s.shopId)}
                    >
                      <ChevronDown
                        className={open === s.shopId ? "rotate-180" : ""}
                      />
                      Top listings
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      data-testid={`watched-shop-${s.shopId}-remove`}
                      aria-label={`Take ${s.name} off the list`}
                      disabled={pending}
                      onClick={() => unwatch(s.shopId)}
                    >
                      <X />
                    </Button>
                  </div>
                </div>
                {open === s.shopId ? (
                  <div
                    className="ml-0 flex flex-col gap-1.5 sm:ml-10"
                    data-testid={`watched-shop-${s.shopId}-favoured`}
                  >
                    <span className="font-sans text-[0.7rem] text-on-surface-dim">
                      By favourites: Etsy gives another shop&apos;s sales only
                      as a lifetime total, never per listing.
                    </span>
                    {shown === undefined ? (
                      <Loader2 className="size-4 animate-spin text-on-surface-dim" />
                    ) : typeof shown === "string" ? (
                      <span className="font-mono text-[0.65rem] text-prov-local">
                        {shown}
                      </span>
                    ) : (
                      <ol className="flex flex-col gap-1">
                        {shown.listings.map((l, n) => (
                          <li
                            key={l.listingId}
                            className="flex items-baseline gap-2 font-sans text-[0.78rem]"
                          >
                            <span className="w-5 flex-shrink-0 font-mono text-[0.65rem] text-on-surface-dim">
                              {n + 1}
                            </span>
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-w-0 flex-1 text-foreground [overflow-wrap:anywhere] hover:text-primary"
                            >
                              {l.title}
                            </a>
                            <span className="flex-shrink-0 text-on-surface-mid">
                              {count(l.favourites)} favourites ·{" "}
                              {moneyLabel(l.price, l.currency)}
                            </span>
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
                <span className="font-semibold text-foreground">{f.name}</span>{" "}
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
      )}
    </div>
  );
}

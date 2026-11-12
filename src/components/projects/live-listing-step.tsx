"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ImagePlus,
  Loader2,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, useTransition } from "react";
import { uploadListingPhotoAction } from "@/app/actions/live-listing";
import { Button } from "@/components/ui/button";
import { FilePick } from "@/components/ui/file-pick";
import { MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { etsyListingId, MAX_LIVE_PHOTOS } from "@/domain/live-listing";
import { cn } from "@/lib/utils";

const LABEL =
  "font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const NOTE = "font-sans text-[0.75rem] text-on-surface-mid";

// One of the listing's photos as it shows now, in Kiln's storage.
export interface LiveRow {
  url: string;
  aspect: string;
  name: string;
  // The frame that replaces it (a shot list key); absent = kept.
  replaceWith?: string;
}

// New project, a Listing kit from a live listing: the listing's address
// (kept, never opened) and its photos in their order, each kept as it is or
// replaced by one of the kit's frames. The first photo starts replaced by the
// hero, the thumbnail buyers click.
export function LiveListingStep({
  frames,
  url,
  onUrl,
  rows,
  onRows,
}: {
  frames: { key: string; label: string }[];
  url: string;
  onUrl: (url: string) => void;
  rows: LiveRow[];
  onRows: (rows: LiveRow[]) => void;
}) {
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const listingId = etsyListingId(url.trim());
  const room = MAX_LIVE_PHOTOS - rows.length;

  function add(files: File[]) {
    startUpload(async () => {
      setError(null);
      const added: LiveRow[] = [];
      for (const file of files.slice(0, room)) {
        const data = new FormData();
        data.set("file", file);
        const result = await uploadListingPhotoAction(data);
        if ("error" in result) setError(result.error);
        else
          added.push({
            url: result.url,
            aspect: result.aspect,
            name: file.name,
          });
      }
      if (files.length > room) {
        setError(`A listing shows at most ${MAX_LIVE_PHOTOS} photos.`);
      }
      const next = [...rows, ...added];
      const hero = frames.some((f) => f.key === "hero");
      if (
        hero &&
        rows.length === 0 &&
        next[0] &&
        !next.some((r) => r.replaceWith)
      ) {
        next[0] = { ...next[0], replaceWith: "hero" };
      }
      onRows(next);
    });
  }

  const set = (i: number, replaceWith: string | undefined) =>
    onRows(rows.map((r, j) => (j === i ? { ...r, replaceWith } : r)));
  const move = (i: number, step: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + step]] = [next[i + step], next[i]];
    onRows(next);
  };
  const frameLabel = (key: string) =>
    frames.find((f) => f.key === key)?.label ?? key;
  const choice = (row: LiveRow) =>
    row.replaceWith
      ? `Replace with ${frameLabel(row.replaceWith)}`
      : "Keep as it is";
  const replaced = rows.filter((r) => r.replaceWith).length;

  return (
    <div className="flex flex-col gap-5 rounded-card bg-card p-6 shadow-card">
      <label className="flex max-w-[640px] flex-col gap-1.5">
        <span className={LABEL}>Listing address (optional)</span>
        <input
          type="url"
          data-testid="live-listing-url"
          value={url}
          placeholder="https://www.etsy.com/listing/…"
          onChange={(e) => onUrl(e.target.value)}
          className="h-9 w-full rounded-field border border-border bg-secondary px-3 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
        <span className={NOTE}>
          {listingId ? `Etsy listing ${listingId}. ` : ""}
          Kiln keeps the address to read the listing's numbers before and after;
          it never opens the page.
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Its photos now, in order</span>
        {rows.length > 0 ? (
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((row, i) => (
              <li
                key={row.url}
                data-testid={`live-photo-${i + 1}`}
                className="flex items-center gap-3 rounded-field bg-surface-soft p-2"
              >
                {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
                <img
                  src={row.url}
                  alt={`Number ${i + 1} on the listing`}
                  className="size-16 flex-shrink-0 rounded-swatch object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-mono text-[0.625rem] text-on-surface-dim">
                    Photo {i + 1}
                    {row.replaceWith ? " · replace with" : ""}
                  </span>
                  <MenuRoot>
                    <MenuTrigger asChild>
                      <button
                        type="button"
                        data-testid={`live-photo-${i + 1}-choice`}
                        aria-label={`Photo ${i + 1}: ${choice(row)}`}
                        className={cn(
                          "inline-flex min-w-0 items-center justify-between gap-1 rounded-[9px] px-2 py-1 text-left font-sans text-[0.8rem] hover:bg-secondary",
                          row.replaceWith
                            ? "font-semibold text-primary"
                            : "text-foreground",
                        )}
                      >
                        <span className="truncate">
                          {row.replaceWith
                            ? frameLabel(row.replaceWith)
                            : "Keep as it is"}
                        </span>
                        <ChevronDown className="size-3 flex-shrink-0 text-on-surface-mid" />
                      </button>
                    </MenuTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        align="start"
                        sideOffset={4}
                        className="z-50 max-h-[320px] min-w-[13rem] overflow-y-auto rounded-field bg-card p-1 shadow-card ring-1 ring-border"
                      >
                        <DropdownMenu.Item
                          data-testid={`live-photo-${i + 1}-keep`}
                          onSelect={() => set(i, undefined)}
                          className="cursor-pointer rounded-[9px] px-2.5 py-1.5 font-sans text-sm text-foreground outline-none data-[highlighted]:bg-secondary"
                        >
                          Keep as it is
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="my-1 h-px bg-border" />
                        <DropdownMenu.Label className="px-2.5 py-1 font-mono text-[0.59rem] text-on-surface-dim">
                          Replace with
                        </DropdownMenu.Label>
                        {frames.map((frame) => (
                          <DropdownMenu.Item
                            key={frame.key}
                            data-testid={`live-photo-${i + 1}-replace-${frame.key}`}
                            disabled={rows.some(
                              (r, j) => j !== i && r.replaceWith === frame.key,
                            )}
                            onSelect={() => set(i, frame.key)}
                            className="cursor-pointer rounded-[9px] px-2.5 py-1.5 font-sans text-sm text-foreground outline-none data-[disabled]:cursor-default data-[disabled]:text-on-surface-dim data-[highlighted]:bg-secondary"
                          >
                            {frame.label}
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </MenuRoot>
                </div>
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move photo ${i + 1} earlier`}
                    data-testid={`live-photo-${i + 1}-up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move photo ${i + 1} later`}
                    data-testid={`live-photo-${i + 1}-down`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove photo ${i + 1}`}
                  data-testid={`live-photo-${i + 1}-remove`}
                  onClick={() => onRows(rows.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {room > 0 ? (
            <FilePick
              variant="secondary"
              size="sm"
              multiple
              accept="image/png,image/jpeg,image/webp"
              testId="live-photos-add"
              disabled={uploading}
              onFiles={add}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
              {rows.length === 0
                ? "Add the listing's photos"
                : "Add more photos"}
            </FilePick>
          ) : null}
          <span className={NOTE}>
            {rows.length === 0
              ? "Your originals, in the order the listing shows them. Kiln never fetches them."
              : `${rows.length} ${rows.length === 1 ? "photo" : "photos"} · ${replaced} to replace · the rest stay as they are.`}
          </span>
        </div>
        {error ? (
          <span className="font-mono text-[0.7rem] text-fail">{error}</span>
        ) : null}
      </div>
    </div>
  );
}

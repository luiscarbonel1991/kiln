"use client";

import { ArrowRight, Eye, EyeOff, Loader2, PenLine, Plus } from "lucide-react";
import Link from "next/link";
import { ToggleGroup } from "radix-ui";
import { useMemo, useState, useTransition } from "react";
import {
  createProjectAction,
  lookDesignAction,
} from "@/app/actions/new-project";
import { importProductsAction } from "@/app/actions/products";
import { BeforeAfter } from "@/components/projects/before-after";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { HeroSettingPicker } from "@/components/projects/hero-setting-picker";
import {
  ImportCatalogCard,
  type ImportOutcome,
  ImportResultPanel,
} from "@/components/projects/import-catalog";
import {
  LiveListingStep,
  type LiveRow,
} from "@/components/projects/live-listing-step";
import { LookPicker } from "@/components/projects/look-picker";
import { PhotoArt } from "@/components/projects/photo-art";
import { ProductEditor } from "@/components/projects/product-editor";
import { SceneArt } from "@/components/projects/scene-art";
import { SkippedFrames } from "@/components/projects/skipped-frames";
import {
  framePosition,
  onIndexes,
  SlotFrame,
  SlotGrid,
  slotPosition,
  unnumbered,
} from "@/components/projects/slot-frame";
import { ReadyMark } from "@/components/ready-mark";
import { Button } from "@/components/ui/button";
import type { BrandKit } from "@/domain/brand";
import { colourTextWarning } from "@/domain/colour-text";
import {
  exactView,
  renderTextTemplate,
  textLayerColours,
} from "@/domain/exact";
import { estimateScenes } from "@/domain/generation-cost";
import {
  type HeroSetting,
  heroProposal,
  heroSettingsOf,
  withHeroSettings,
} from "@/domain/hero-setting";
import { destinationImageSize, sizeOn } from "@/domain/image-size";
import {
  defaultImageModel,
  defaultVideoModel,
  type MakerModels,
  modelLabel,
} from "@/domain/model-defaults";
import {
  offeredDestinations,
  type ProjectPlan,
  planFromListing,
  planProject,
  planVideos,
  replacementFrames,
  skippedFrames,
  slotCardId,
} from "@/domain/plan";
import {
  buyerSizeLabel,
  colourOf,
  type Product,
  productImages,
} from "@/domain/product";
import {
  type Look,
  lookLabel,
  ORIGINAL,
  productInLook,
  productStyles,
  resolveLook,
  sameLook,
  storedLook,
  styleName,
} from "@/domain/product-look";
import type { ProjectType } from "@/domain/project";
import { plateHref } from "@/lib/plate-href";
import { plural } from "@/lib/plural";
import { PROJECT_TYPES } from "@/lib/project-types";
import { CATALOG } from "@/lib/recipes";
import { cn } from "@/lib/utils";
import { versionMark } from "@/lib/version-mark";
import type { StoredProductFile } from "@/server/product-files";

type BoardType = Exclude<ProjectType, "design">;

const REFERENCE_NOTE: Record<Product["source"]["kind"], string> = {
  photo: "The product photo is the reference every scene starts from.",
  vector:
    "The design SVG becomes the reference plate, rendered locally (free).",
  catalog:
    "On the board you add one reference image (a photo or your own plate) before any scene is generated.",
  form: "On the board you add one reference image (a photo or your own plate) before any scene is generated.",
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// The New project flow: pick a product (or add one: a short form, a photo or a
// design file — no file format to learn; a catalog export still imports), then
// three decisions. Every frame of the plan is previewed here; exact ones are
// already final. Start creates the project and opens its board; it calls no
// model.
export function NewProjectFlow({
  initialProducts,
  initialBrand,
  makerModels,
  sceneLook = null,
  draftPrice,
  reviewPrice,
  rememberedHero = {},
  initialDesign,
  initialProductId = null,
  initialListingUrl = null,
  initialListingTitle = null,
}: {
  initialProducts: Product[];
  initialBrand: BrandKit | null;
  makerModels: MakerModels;
  // What the look at each scene adds to the plan's estimate, when it is on.
  sceneLook?: { typical: number; max: number } | null;
  draftPrice: string | null;
  reviewPrice: string | null;
  // The maker's remembered hero settings, per destination and family.
  rememberedHero?: Record<string, HeroSetting>;
  // A design handed over from the studio ("Make it a product").
  initialDesign: StoredProductFile | null;
  // A product picked on Home.
  initialProductId?: string | null;
  // A live listing to refresh, picked on Shops: a Listing kit started from it.
  initialListingUrl?: string | null;
  initialListingTitle?: string | null;
}) {
  const [products, setProducts] = useState(initialProducts);
  // The new-product form: open from the start for a maker with no products
  // yet, or a design handed over from the studio.
  const [creating, setCreating] = useState(
    initialProducts.length === 0 || initialDesign !== null,
  );
  const [brand, setBrand] = useState(initialBrand);
  // A single product is picked for the maker, except for a listing from
  // Shops: it may be a product Kiln does not have yet, so the maker says.
  const [productId, setProductId] = useState<string | null>(
    initialProductId ??
      (initialProducts.length === 1 && !initialListingUrl
        ? initialProducts[0].id
        : null),
  );
  const [type, setType] = useState<BoardType | null>(
    initialListingUrl ? "listing-kit" : null,
  );
  // A Listing kit starts from the product, or from a listing already selling
  // (its address and its photos, some to replace).
  const [startFrom, setStartFrom] = useState<"product" | "live">(
    initialListingUrl ? "live" : "product",
  );
  const [listingUrl, setListingUrl] = useState(initialListingUrl ?? "");
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  // The hero setting the maker picked per destination (else the proposal).
  const [heroChoices, setHeroChoices] = useState<Record<string, HeroSetting>>(
    {},
  );
  const [destinationIds, setDestinationIds] = useState<string[]>(() => {
    if (!initialListingUrl) return [];
    const offered = offeredDestinations("listing-kit", CATALOG);
    const etsy = offered.find((d) => d.id === "etsy") ?? offered[0];
    return etsy ? [etsy.id] : [];
  });
  // Slot card ids ("etsy.gift") the maker switched off for this product.
  const [offSlots, setOffSlots] = useState<string[]>([]);
  const [importOutcome, setImportOutcome] = useState<ImportOutcome | null>(
    null,
  );
  // A note from saving the new-product form (its drawing off its size).
  const [createdNote, setCreatedNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  // The colour and style the project shows, for the product picked (else
  // its default, which the project never changes), and the design Kiln
  // redrew for each look, so the exact frames preview in it.
  const [lookChoice, setLookChoice] = useState<{
    productId: string;
    look: Look;
  } | null>(null);
  const [designs, setDesigns] = useState<Record<string, string>>({});
  const [lookError, setLookError] = useState<string | null>(null);
  const [drawingLook, startDrawingLook] = useTransition();

  const product = products.find((p) => p.id === productId) ?? null;
  const asked =
    lookChoice && lookChoice.productId === product?.id
      ? lookChoice.look
      : undefined;
  const look = product ? resolveLook(product, asked) : null;
  const ownLook = product && look && !sameLook(look, resolveLook(product));
  const designKey =
    product && look ? `${product.id}/${look.colour}/${look.style ?? ""}` : "";
  // The product as the project would show it: exact frames preview in it.
  const shown =
    product && look ? productInLook(product, look, designs[designKey]) : null;
  const offered = type ? offeredDestinations(type, CATALOG) : [];
  const live = type === "listing-kit" && startFrom === "live";
  const frames =
    live && product && destinationIds[0]
      ? replacementFrames(product, destinationIds[0], CATALOG).map((f) => ({
          key: f.key,
          label: f.label,
        }))
      : [];

  // The plan, or why there is none yet (a live listing's photos to mark).
  const { plan: planned0, planError } = useMemo<{
    plan: ProjectPlan | null;
    planError: string | null;
  }>(() => {
    if (!product || !type || destinationIds.length === 0) {
      return { plan: null, planError: null };
    }
    try {
      if (live) {
        if (liveRows.length === 0) return { plan: null, planError: null };
        return {
          plan: planFromListing({
            product,
            destinationId: destinationIds[0],
            catalog: CATALOG,
            photos: liveRows.map(({ url, aspect, replaceWith }) => ({
              url,
              aspect,
              ...(replaceWith ? { replaceWith } : {}),
            })),
          }),
          planError: null,
        };
      }
      return {
        plan: planProject({ product, type, destinationIds, catalog: CATALOG }),
        planError: null,
      };
    } catch (error) {
      return { plan: null, planError: (error as Error).message };
    }
  }, [product, type, destinationIds, live, liveRows]);
  // Each hero's setting: the maker's pick, else Kiln's proposal.
  const proposalFor = (destinationId: string) =>
    product ? heroProposal(product, destinationId, rememberedHero) : null;
  const plan =
    planned0 && product
      ? withHeroSettings(
          planned0,
          (id) => heroChoices[id] ?? proposalFor(id)?.setting,
        )
      : planned0;

  const planned =
    plan?.destinations.flatMap((d) =>
      d.slots.map((slot) => ({
        id: slotCardId(d.destinationId, slot.key),
        slot,
        destinationId: d.destinationId,
      })),
    ) ?? [];
  const off = planned.filter((p) => offSlots.includes(p.id)).map((p) => p.id);
  const inPlan = planned.filter((p) => !off.includes(p.id));
  const slots = inPlan.map((p) => p.slot);
  const scenes = slots.filter((s) => s.fill === "scene");
  const shared = slots.filter((s) => s.fill === "shared").length;
  const kept = slots.filter((s) => s.fill === "photo").length;
  const exact = slots.filter((s) => s.fill === "exact").length;
  const model = defaultImageModel(makerModels);
  // Each scene reads the sample and the views beside the reference, at the
  // size its destination asks for (2K for Etsy).
  const sized = inPlan
    .filter((p) => p.slot.fill === "scene")
    .map((p) => ({
      aspect: p.slot.aspect,
      size: destinationImageSize(
        p.slot.aspect,
        CATALOG.destinations.find((d) => d.id === p.destinationId),
      ),
    }));
  const at2k = sized.filter(
    (s) => sizeOn({ ...model, size: s.size }, s.aspect) === "2k",
  ).length;
  const estimate = estimateScenes(
    sized,
    model,
    shown ? productImages(shown).length : 0,
    sceneLook,
  );
  // A video is paid like a scene, so the plan prices it too.
  const videoModel = defaultVideoModel(makerModels);
  const videos = plan
    ? planVideos(plan, CATALOG.destinations, videoModel, off)
    : { count: 0, seconds: [], usd: 0 };

  // A look apart from the product's default is redrawn for the preview
  // (free, stored by its bytes); one Kiln cannot draw says why and is not
  // taken.
  function chooseLook(next: Look) {
    if (!product || !look) return;
    const merged = { ...storedLook(look), ...next };
    const resolved = resolveLook(product, merged);
    const key = `${product.id}/${resolved.colour}/${resolved.style ?? ""}`;
    const before = lookChoice;
    setLookChoice({ productId: product.id, look: merged });
    setLookError(null);
    if (designs[key] || sameLook(resolved, resolveLook(product))) return;
    startDrawingLook(async () => {
      const result = await lookDesignAction({
        productId: product.id,
        look: merged,
      });
      if ("error" in result) {
        setLookError(result.error);
        setLookChoice(before);
        return;
      }
      setDesigns((all) => ({ ...all, [key]: result.design }));
    });
  }

  function toggleSlot(id: string) {
    setOffSlots((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  function chooseType(next: BoardType) {
    setType(next);
    if (next !== "listing-kit") setStartFrom("product");
    const ids = offeredDestinations(next, CATALOG).map((d) => d.id);
    setDestinationIds(
      next === "listing-kit" && startFrom === "live" ? ids.slice(0, 1) : ids,
    );
  }

  // A live listing is on one destination: its first offered one to start.
  function chooseStart(next: "product" | "live") {
    setStartFrom(next);
    setOffSlots([]);
    const ids = offeredDestinations("listing-kit", CATALOG).map((d) => d.id);
    setDestinationIds(next === "live" ? ids.slice(0, 1) : ids);
  }

  function toggleDestination(id: string) {
    if (live) {
      setDestinationIds([id]);
      setLiveRows((rows) => rows.map(({ replaceWith: _r, ...row }) => row));
      return;
    }
    setDestinationIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  async function importText(text: string, from: string) {
    setImporting(true);
    setImportOutcome(null);
    setCreatedNote(null);
    try {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        setImportOutcome({
          error: `${from} is not valid JSON (${(error as Error).message}).`,
        });
        return;
      }
      const result = await importProductsAction(json);
      setImportOutcome(result);
      if ("error" in result) return;
      const imported = result.imported.map((i) => i.product);
      setProducts((current) => {
        const byId = new Map(current.map((p) => [p.id, p]));
        for (const p of imported) byId.set(p.id, p);
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
      if (imported[0]) setProductId(imported[0].id);
      if (result.brand) setBrand(result.brand);
    } catch (error) {
      setImportOutcome({
        error: `The import failed: ${(error as Error).message}`,
      });
    } finally {
      setImporting(false);
    }
  }

  function start() {
    if (!product || !type || destinationIds.length === 0) return;
    setStartError(null);
    startTransition(async () => {
      const result = await createProjectAction({
        productId: product.id,
        type,
        destinationIds,
        offSlots: off,
        heroSettings: Object.fromEntries(
          (plan ? heroSettingsOf(plan) : []).map((h) => [
            h.destinationId,
            h.setting,
          ]),
        ),
        ...(ownLook && look ? { look: storedLook(look) } : {}),
        ...(live
          ? {
              live: {
                ...(listingUrl.trim() ? { listingUrl: listingUrl.trim() } : {}),
                photos: liveRows.map(({ url, aspect, replaceWith }) => ({
                  url,
                  aspect,
                  ...(replaceWith ? { replaceWith } : {}),
                })),
              },
            }
          : {}),
      });
      if (result?.error) setStartError(result.error);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-6 py-10 sm:px-8">
      <ReadyMark page="new-project" />
      <div>
        <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
          New project
        </p>
        <h1
          className="mt-2 font-serif text-[1.875rem] font-semibold leading-tight text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          Start from the product, not a prompt.
        </h1>
      </div>

      {/* 1 · Product */}
      <Step n={1} title="Product">
        <p className="-mt-2 font-sans text-[0.8125rem] text-on-surface-mid">
          {initialListingUrl && !productId ? (
            <span data-testid="listing-product-ask">
              Which product is{" "}
              {initialListingTitle ? (
                <strong className="text-foreground">
                  “{initialListingTitle}”
                </strong>
              ) : (
                "this listing"
              )}
              ? Pick it, or add it if Kiln does not have it yet.
            </span>
          ) : (
            "Pick a product, add a new one, or import your catalog."
          )}
        </p>
        {importOutcome ? (
          <ImportResultPanel
            outcome={importOutcome}
            onDismiss={() => setImportOutcome(null)}
          />
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {creating ? (
            <ProductEditor
              materials={[...new Set(products.map((p) => p.material))].sort()}
              families={[...new Set(products.map((p) => p.family))].sort()}
              draftPrice={draftPrice}
              reviewPrice={reviewPrice}
              initialFile={initialDesign}
              onCreated={(created, warning) => {
                setProducts((current) =>
                  [...current.filter((p) => p.id !== created.id), created].sort(
                    (a, b) => a.name.localeCompare(b.name),
                  ),
                );
                setProductId(created.id);
                setImportOutcome(null);
                setCreatedNote(warning ?? null);
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          ) : null}
          {products.map((p) => (
            <div key={p.id} className="group/product relative flex">
              <button
                type="button"
                aria-pressed={p.id === productId}
                data-testid={`product-${p.sku}`}
                onClick={() => setProductId(p.id)}
                className={cn(
                  "flex w-full flex-col gap-2 rounded-card bg-card p-5 text-left shadow-card transition-shadow",
                  p.id === productId
                    ? "ring-2 ring-primary"
                    : "hover:ring-1 hover:ring-border",
                )}
              >
                <span className="font-mono text-[0.625rem] text-on-surface-dim">
                  {p.sku} · {p.source.kind}
                </span>
                <span className="font-serif text-lg leading-tight text-foreground">
                  {p.name}
                </span>
                <span className="font-sans text-[0.8rem] text-on-surface-mid">
                  {buyerSizeLabel(p)} · {p.material}
                </span>
                <span className="flex gap-1.5 pt-1">
                  {p.colours.map((c) => (
                    <span
                      key={c.key}
                      title={c.inStock ? c.name : `${c.name} (out of stock)`}
                      className="size-4 rounded-swatch border border-border"
                      style={{
                        backgroundColor: c.face,
                        opacity: c.inStock ? 1 : 0.35,
                      }}
                    />
                  ))}
                </span>
              </button>
              <Link
                href={`/products/${encodeURIComponent(p.id)}?back=${encodeURIComponent(`/projects/new?product=${p.id}`)}`}
                aria-label={`Edit ${p.name}`}
                className="absolute top-3 right-3 rounded-pill bg-card p-1.5 text-on-surface-mid opacity-0 shadow-card transition group-hover/product:opacity-100 hover:text-foreground focus-visible:opacity-100"
              >
                <PenLine className="size-3.5" />
              </Link>
            </div>
          ))}
          {creating ? null : (
            <button
              type="button"
              data-testid="product-new"
              onClick={() => setCreating(true)}
              className="flex flex-col justify-center gap-2 rounded-card bg-card p-5 text-left shadow-card transition-shadow hover:ring-1 hover:ring-primary"
            >
              <span className="flex size-8 items-center justify-center rounded-pill bg-primary/10 text-primary">
                <Plus className="size-4" />
              </span>
              <span className="font-serif text-lg leading-tight text-foreground">
                New product
              </span>
              <span className="font-sans text-[0.8rem] leading-snug text-on-surface-mid">
                Type it in, from a photo or a design file. No file format to
                learn.
              </span>
            </button>
          )}
          <ImportCatalogCard importing={importing} onImport={importText} />
        </div>
        {createdNote ? (
          <p className="mt-3 rounded-field bg-surface-soft px-4 py-3 font-mono text-[0.7rem] text-on-surface-mid">
            {createdNote}
          </p>
        ) : null}
      </Step>

      {/* 2 · Type */}
      <Step n={2} title="Type" muted={!product}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROJECT_TYPES.map((t) =>
            t.type === "design" ? (
              <Link
                key={t.type}
                href="/studio?new=1"
                data-testid="type-design"
                className="flex flex-col gap-1.5 rounded-card bg-card/60 p-5 shadow-card hover:ring-1 hover:ring-border"
              >
                <span className="font-serif text-lg text-foreground">
                  {t.label}
                </span>
                <span className="font-sans text-[0.78rem] leading-snug text-on-surface-mid">
                  {t.description}
                </span>
              </Link>
            ) : (
              <button
                key={t.type}
                type="button"
                disabled={!product}
                aria-pressed={type === t.type}
                data-testid={`type-${t.type}`}
                onClick={() => chooseType(t.type as BoardType)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-card bg-card p-5 text-left shadow-card disabled:opacity-50",
                  type === t.type
                    ? "ring-2 ring-primary"
                    : "enabled:hover:ring-1 enabled:hover:ring-border",
                )}
              >
                <span className="font-serif text-lg text-foreground">
                  {t.label}
                </span>
                <span className="font-sans text-[0.78rem] leading-snug text-on-surface-mid">
                  {t.description}
                </span>
              </button>
            ),
          )}
        </div>
        {type === "listing-kit" ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
              Start from
            </span>
            <ToggleGroup.Root
              type="single"
              aria-label="Start the listing kit from"
              value={startFrom}
              onValueChange={(next) => {
                if (next) chooseStart(next as "product" | "live");
              }}
              className="flex gap-1 rounded-field bg-secondary p-1"
            >
              {(
                [
                  ["product", "The product"],
                  ["live", "A live listing"],
                ] as const
              ).map(([value, label]) => (
                <ToggleGroup.Item
                  key={value}
                  value={value}
                  data-testid={`start-from-${value}`}
                  className={cn(
                    "h-8 rounded-[9px] px-3 font-sans text-[0.8rem] transition-colors",
                    startFrom === value
                      ? "bg-primary text-primary-foreground"
                      : "text-on-surface-mid hover:bg-surface-soft",
                  )}
                >
                  {label}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
            <span className="font-sans text-[0.75rem] text-on-surface-mid">
              {startFrom === "live"
                ? "Refresh a listing already selling: keep its photos and replace the ones that need it."
                : "Every frame planned from the product's spec."}
            </span>
          </div>
        ) : null}
      </Step>

      {/* 3 · Destinations */}
      <Step n={3} title="Destinations" muted={!type}>
        {type ? (
          <div className="flex flex-wrap gap-3">
            {offered.map((d) => {
              const on = destinationIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={on}
                  data-testid={`destination-${d.id}`}
                  onClick={() => toggleDestination(d.id)}
                  className={cn(
                    "flex min-w-[220px] flex-col gap-1 rounded-card bg-card px-5 py-4 text-left shadow-card",
                    on ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100",
                  )}
                >
                  <span className="font-serif text-lg text-foreground">
                    {d.name}
                  </span>
                  <span className="font-mono text-[0.625rem] text-on-surface-mid">
                    {d.kind} · {d.formats.map((f) => f.aspect).join(" / ")} ·{" "}
                    {d.delivery.mode === "export" ? "export folder" : "draft"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="font-sans text-sm text-on-surface-dim">
            Pick a type first.
          </p>
        )}
        {live ? (
          <p className="font-sans text-[0.75rem] text-on-surface-mid">
            A live listing is on one destination.
          </p>
        ) : null}
      </Step>

      {live ? (
        <Step n={4} title="Live listing" muted={destinationIds.length === 0}>
          {product && destinationIds[0] ? (
            <LiveListingStep
              frames={frames}
              url={listingUrl}
              onUrl={setListingUrl}
              rows={liveRows}
              onRows={setLiveRows}
            />
          ) : (
            <p className="font-sans text-sm text-on-surface-dim">
              Pick a destination first.
            </p>
          )}
        </Step>
      ) : null}

      {/* Plan */}
      <Step n={live ? 5 : 4} title="Plan" muted={!plan}>
        {plan && product ? (
          <div className="flex flex-col gap-6">
            <ProjectLook
              product={product}
              look={look ?? resolveLook(product)}
              own={Boolean(ownLook)}
              pending={drawingLook}
              error={lookError}
              onLook={chooseLook}
            />
            {plan.destinations.map((d) => {
              const destination = CATALOG.destinations.find(
                (x) => x.id === d.destinationId,
              );
              if (!destination) return null;
              return (
                <section key={d.destinationId} className="flex flex-col gap-3">
                  <h3 className="font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
                    {destination.name} ·{" "}
                    {plural(
                      d.slots.filter(
                        (s) =>
                          !off.includes(slotCardId(d.destinationId, s.key)),
                      ).length,
                      "frame",
                    )}
                  </h3>
                  <SkippedFrames
                    frames={skippedFrames(d, product, CATALOG.shotLists)}
                    testId={`plan-skipped-${d.destinationId}`}
                  />
                  <SlotGrid>
                    {d.slots.map((slot, i) => {
                      const id = slotCardId(d.destinationId, slot.key);
                      const isOff = off.includes(id);
                      // A video and a frame posted on its own take no number.
                      const place = onIndexes(
                        d.slots.map(
                          (s) =>
                            unnumbered(s) ||
                            off.includes(slotCardId(d.destinationId, s.key)),
                        ),
                      )[i];
                      return (
                        <SlotFrame
                          key={slot.key}
                          testId={`plan-slot-${id}`}
                          position={framePosition(
                            destination,
                            slot,
                            place,
                            isOff,
                          )}
                          label={slot.label}
                          purpose={slot.purpose}
                          aspect={slot.aspect}
                          mark={versionMark(plan, slot, { waits: false })}
                          view={{
                            state: isOff
                              ? "off"
                              : slot.fill === "exact"
                                ? "exact"
                                : slot.fill === "photo"
                                  ? "kept"
                                  : "queued",
                            failed: false,
                          }}
                          actions={
                            <div className="flex flex-col gap-2">
                              {slot.knobs?.setting === "sweep" ||
                              slot.knobs?.setting === "place" ? (
                                <HeroSettingPicker
                                  value={slot.knobs.setting}
                                  proposal={
                                    proposalFor(d.destinationId) ?? {
                                      setting: "sweep",
                                      source: "default",
                                    }
                                  }
                                  family={product.family}
                                  destination={destination.name}
                                  testId={`hero-setting-${d.destinationId}`}
                                  onChange={(setting) =>
                                    setHeroChoices((all) => ({
                                      ...all,
                                      [d.destinationId]: setting,
                                    }))
                                  }
                                />
                              ) : null}
                              <Button
                                variant="ghost"
                                size="xs"
                                className="self-start"
                                data-testid={`plan-slot-${id}-switch`}
                                onClick={() => toggleSlot(id)}
                              >
                                {isOff ? <Eye /> : <EyeOff />}
                                {isOff ? "Switch on" : "Switch off"}
                              </Button>
                            </div>
                          }
                        >
                          {withBefore(
                            slot.before,
                            id,
                            slot.fill === "photo" && slot.photo ? (
                              <PhotoArt
                                url={slot.photo}
                                alt={`${slotPosition(destination, place)} now`}
                              />
                            ) : slot.exact ? (
                              <ExactSlotArt
                                view={exactView(
                                  slot.exact,
                                  shown ?? product,
                                  slot.textTemplate,
                                  brand,
                                )}
                                aspect={slot.aspect}
                                plate={plateHref(shown ?? product)}
                              />
                            ) : (
                              <SceneArt
                                seed={`${d.destinationId}.${slot.key}`}
                                text={
                                  slot.textTemplate
                                    ? renderTextTemplate(
                                        slot.textTemplate,
                                        shown ?? product,
                                      )
                                    : undefined
                                }
                                band={textLayerColours(brand)}
                                aspect={slot.aspect}
                                badge={
                                  slot.fill === "shared"
                                    ? "shared"
                                    : slot.versionOf
                                      ? "version"
                                      : "scene"
                                }
                              />
                            ),
                          )}
                        </SlotFrame>
                      );
                    })}
                  </SlotGrid>
                </section>
              );
            })}

            <div className="flex flex-col gap-4 rounded-card bg-card p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1.5">
                <p className="font-sans text-sm text-foreground">
                  {live ? (
                    <>
                      <strong>{plural(kept, "photo")}</strong>{" "}
                      {kept === 1 ? "stays" : "stay"} as{" "}
                      {kept === 1 ? "it is" : "they are"}.{" "}
                      {plural(exact, "exact frame")} — drawn from the spec, free
                      and final —{" "}
                    </>
                  ) : (
                    <>
                      <strong>
                        {exact} of {slots.length}
                      </strong>{" "}
                      {slots.length === 1 ? "frame is" : "frames are"} exact —
                      drawn from the spec, free and final.{" "}
                    </>
                  )}
                  {live ? "and " : ""}
                  {plural(scenes.length, "scene")}{" "}
                  {scenes.length === 1 ? "needs" : "need"} the image model.
                  {videos.count > 0
                    ? ` ${plural(videos.count, "video")} ${videos.count === 1 ? "needs" : "need"} the video model.`
                    : ""}
                  {shared > 0
                    ? ` ${plural(shared, "frame")} ${shared === 1 ? "repeats a scene" : "repeat scenes"} another destination makes, free.`
                    : ""}
                  {off.length > 0
                    ? ` ${off.length} switched off, not part of the deliverable.`
                    : ""}
                </p>
                <p className="font-mono text-[0.7rem] text-on-surface-mid">
                  {estimate
                    ? `≈ ${money(estimate.typical)}–${money(estimate.max)} if each scene is generated once · ${model.model}${estimate.quality ? `, quality ${estimate.quality}` : ""}${at2k > 0 ? `, ${at2k} at 2K for ${at2k === 1 ? "its destination" : "their destinations"}` : ""}${sceneLook ? ", each looked at once it lands" : ""}${estimate.confidence === "derived" ? " (derived price)" : ""}`
                    : `no pinned price for ${model.model}`}
                </p>
                {videos.count > 0 ? (
                  <p
                    className="font-mono text-[0.7rem] text-on-surface-mid"
                    data-testid="plan-video-estimate"
                  >
                    {videos.usd === null
                      ? `no pinned price for ${videoModel.model} at ${videos.seconds.join(", ")} s`
                      : `+ ${money(videos.usd)} for ${videos.count === 1 ? "the video" : `${videos.count} videos`} (${videos.seconds.join(", ")} s, ${modelLabel(videoModel)})${estimate ? ` · ≈ ${money(estimate.typical + videos.usd)}–${money(estimate.max + videos.usd)} in all` : ""}`}
                  </p>
                ) : null}
                <p className="font-sans text-[0.75rem] text-on-surface-mid">
                  Nothing is generated when you start: each scene waits for your
                  Generate. {REFERENCE_NOTE[product.source.kind]}
                </p>
              </div>
              <Button
                data-testid="project-start"
                onClick={start}
                disabled={starting}
                className="h-10 rounded-field px-5 font-semibold shadow-button"
              >
                {starting ? <Loader2 className="animate-spin" /> : null}
                Start project <ArrowRight />
              </Button>
            </div>
            {startError ? (
              <p className="font-mono text-[0.7rem] text-fail">{startError}</p>
            ) : null}
          </div>
        ) : (
          <p className="font-sans text-sm text-on-surface-dim">
            {planError
              ? `${planError[0].toUpperCase()}${planError.slice(1)}.`
              : live
                ? "The plan appears once the listing's photos are here and one is marked to replace."
                : "The plan appears once a product, a type and a destination are chosen."}
          </p>
        )}
      </Step>
    </main>
  );
}

// A frame that replaces a live photo carries the photo, a click away.
function withBefore(
  before: { url: string; aspect: string } | undefined,
  id: string,
  art: React.ReactNode,
) {
  return before ? (
    <BeforeAfter before={before} testId={`before-${id}`}>
      {art}
    </BeforeAfter>
  ) : (
    art
  );
}

function Step({
  n,
  title,
  muted,
  children,
}: {
  n: number;
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-4", muted && "opacity-60")}>
      <h2 className="flex items-baseline gap-3">
        <span className="font-mono text-[0.7rem] text-primary">0{n}</span>
        <span
          className="font-serif text-xl text-foreground"
          style={{ fontVariationSettings: "'opsz' 40" }}
        >
          {title}
        </span>
      </h2>
      {children}
    </section>
  );
}

// The colour and style the project shows. Only a product drawn from an SVG can
// be shown in another: Kiln redraws its design. The product's own default never
// changes for it.
function ProjectLook({
  product,
  look,
  own,
  pending,
  error,
  onLook,
}: {
  product: Product;
  look: { colour: string; style: string | null };
  own: boolean;
  pending: boolean;
  error: string | null;
  onLook: (look: Look) => void;
}) {
  const styles = productStyles(product);
  if (product.colours.length < 2 && styles.length === 0) return null;
  const NOTE = "font-sans text-[0.75rem] text-on-surface-mid";
  if (product.source.kind !== "vector") {
    return product.colours.length > 1 ? (
      <p className={NOTE} data-testid="project-look-fixed">
        Scenes show {colourOf(product, product.defaultColour).name}: Kiln draws
        other colours from a design file.
      </p>
    ) : null;
  }
  return (
    <section className="flex flex-col gap-2">
      <LookPicker
        testId="project-look"
        label="font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim"
        disabled={pending}
        colours={product.colours.map((c) => {
          const warning = colourTextWarning(product, c.key);
          return {
            key: c.key,
            label: c.name,
            face: c.face,
            ...(c.inStock ? {} : { refused: `${c.name} is out of stock` }),
            ...(warning ? { warning } : {}),
          };
        })}
        styles={[
          { key: ORIGINAL, label: styleName(product, null) },
          ...styles.map((s) => ({ key: s.key, label: s.name })),
        ]}
        colour={look.colour}
        style={look.style ?? ORIGINAL}
        onColour={(colour) => colour && onLook({ colour })}
        onStyle={(style) => style && onLook({ style })}
      />
      <p className={NOTE} data-testid="project-look-note">
        {pending ? (
          <Loader2 className="mr-1 inline size-3 animate-spin" />
        ) : null}
        Scenes and exact frames show {lookLabel(product, look)}
        {own
          ? `; the product's default stays ${colourOf(product, product.defaultColour).name}.`
          : "."}
      </p>
      {error ? (
        <p
          role="alert"
          className="font-sans text-[0.75rem] text-fail"
          data-testid="project-look-error"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

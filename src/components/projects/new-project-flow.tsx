"use client";

import { ArrowRight, Eye, EyeOff, Loader2, PenLine, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createProjectAction } from "@/app/actions/new-project";
import { importProductsAction } from "@/app/actions/products";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import {
  ImportCatalogCard,
  type ImportOutcome,
  ImportResultPanel,
} from "@/components/projects/import-catalog";
import { ProductEditor } from "@/components/projects/product-editor";
import { SceneArt } from "@/components/projects/scene-art";
import {
  onIndexes,
  SlotFrame,
  SlotGrid,
  slotPosition,
} from "@/components/projects/slot-frame";
import { Button } from "@/components/ui/button";
import type { BrandKit } from "@/domain/brand";
import {
  exactView,
  renderTextTemplate,
  textLayerColours,
} from "@/domain/exact";
import { estimateScenes } from "@/domain/generation-cost";
import { defaultImageModel, type MakerModels } from "@/domain/model-defaults";
import {
  offeredDestinations,
  type ProjectPlan,
  planProject,
  slotCardId,
} from "@/domain/plan";
import { buyerSizeLabel, type Product, productImages } from "@/domain/product";
import type { ProjectType } from "@/domain/project";
import { plateHref } from "@/lib/plate-href";
import { plural } from "@/lib/plural";
import { PROJECT_TYPES } from "@/lib/project-types";
import { CATALOG } from "@/lib/recipes";
import { cn } from "@/lib/utils";
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

// The New project flow (ROADMAP "Experience design"): pick a product (or add
// one: a short form, a photo or a design file — no file format to learn; a
// catalog export still imports), then three decisions. Every frame of the
// plan is previewed here; exact ones are already final. Start creates the
// project and opens its board; it calls no model.
export function NewProjectFlow({
  initialProducts,
  initialBrand,
  makerModels,
  draftPrice,
  reviewPrice,
  initialDesign,
  initialProductId = null,
}: {
  initialProducts: Product[];
  initialBrand: BrandKit | null;
  makerModels: MakerModels;
  draftPrice: string | null;
  reviewPrice: string | null;
  // A design handed over from the studio ("Make it a product").
  initialDesign: StoredProductFile | null;
  // A product picked on Home.
  initialProductId?: string | null;
}) {
  const [products, setProducts] = useState(initialProducts);
  // The new-product form: open from the start for a maker with no products
  // yet, or a design handed over from the studio.
  const [creating, setCreating] = useState(
    initialProducts.length === 0 || initialDesign !== null,
  );
  const [brand, setBrand] = useState(initialBrand);
  const [productId, setProductId] = useState<string | null>(
    initialProductId ??
      (initialProducts.length === 1 ? initialProducts[0].id : null),
  );
  const [type, setType] = useState<BoardType | null>(null);
  const [destinationIds, setDestinationIds] = useState<string[]>([]);
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

  const product = products.find((p) => p.id === productId) ?? null;
  const offered = type ? offeredDestinations(type, CATALOG) : [];

  const plan = useMemo<ProjectPlan | null>(() => {
    if (!product || !type || destinationIds.length === 0) return null;
    try {
      return planProject({ product, type, destinationIds, catalog: CATALOG });
    } catch {
      return null;
    }
  }, [product, type, destinationIds]);

  const planned =
    plan?.destinations.flatMap((d) =>
      d.slots.map((slot) => ({
        id: slotCardId(d.destinationId, slot.key),
        slot,
      })),
    ) ?? [];
  const off = planned.filter((p) => offSlots.includes(p.id)).map((p) => p.id);
  const slots = planned.filter((p) => !off.includes(p.id)).map((p) => p.slot);
  const scenes = slots.filter((s) => s.fill === "scene");
  const model = defaultImageModel(makerModels);
  // Each scene reads the sample and the views beside the reference.
  const estimate = estimateScenes(
    scenes,
    model,
    product ? productImages(product).length : 0,
  );

  function toggleSlot(id: string) {
    setOffSlots((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  function chooseType(next: BoardType) {
    setType(next);
    setDestinationIds(offeredDestinations(next, CATALOG).map((d) => d.id));
  }

  function toggleDestination(id: string) {
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
      });
      if (result?.error) setStartError(result.error);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-6 py-10 sm:px-8">
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
          Pick a product, add a new one, or import your catalog.
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
                <span className="font-serif text-lg italic leading-tight text-foreground">
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
              onClick={() => setCreating(true)}
              className="flex flex-col justify-center gap-2 rounded-card bg-card p-5 text-left shadow-card transition-shadow hover:ring-1 hover:ring-primary"
            >
              <span className="flex size-8 items-center justify-center rounded-pill bg-primary/10 text-primary">
                <Plus className="size-4" />
              </span>
              <span className="font-serif text-lg italic leading-tight text-foreground">
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
                className="flex flex-col gap-1.5 rounded-card bg-card/60 p-5 shadow-card hover:ring-1 hover:ring-border"
              >
                <span className="font-serif text-lg italic text-foreground">
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
                onClick={() => chooseType(t.type as BoardType)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-card bg-card p-5 text-left shadow-card disabled:opacity-50",
                  type === t.type
                    ? "ring-2 ring-primary"
                    : "enabled:hover:ring-1 enabled:hover:ring-border",
                )}
              >
                <span className="font-serif text-lg italic text-foreground">
                  {t.label}
                </span>
                <span className="font-sans text-[0.78rem] leading-snug text-on-surface-mid">
                  {t.description}
                </span>
              </button>
            ),
          )}
        </div>
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
                  onClick={() => toggleDestination(d.id)}
                  className={cn(
                    "flex min-w-[220px] flex-col gap-1 rounded-card bg-card px-5 py-4 text-left shadow-card",
                    on ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100",
                  )}
                >
                  <span className="font-serif text-lg italic text-foreground">
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
      </Step>

      {/* 4 · Plan */}
      <Step n={4} title="Plan" muted={!plan}>
        {plan && product ? (
          <div className="flex flex-col gap-6">
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
                  <SlotGrid>
                    {d.slots.map((slot, i) => {
                      const id = slotCardId(d.destinationId, slot.key);
                      const isOff = off.includes(id);
                      // A video takes no photo number.
                      const place = onIndexes(
                        d.slots.map(
                          (s) =>
                            s.fill === "video" ||
                            off.includes(slotCardId(d.destinationId, s.key)),
                        ),
                      )[i];
                      return (
                        <SlotFrame
                          key={slot.key}
                          position={
                            slot.fill === "video"
                              ? `${destination.name} video`
                              : slotPosition(destination, place)
                          }
                          label={slot.label}
                          purpose={slot.purpose}
                          aspect={slot.aspect}
                          view={{
                            state: isOff
                              ? "off"
                              : slot.fill === "exact"
                                ? "exact"
                                : "queued",
                            failed: false,
                          }}
                          actions={
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => toggleSlot(id)}
                            >
                              {isOff ? <Eye /> : <EyeOff />}
                              {isOff ? "Switch on" : "Switch off"}
                            </Button>
                          }
                        >
                          {slot.exact ? (
                            <ExactSlotArt
                              view={exactView(
                                slot.exact,
                                product,
                                slot.textTemplate,
                                brand,
                              )}
                              aspect={slot.aspect}
                              plate={plateHref(product)}
                            />
                          ) : (
                            <SceneArt
                              seed={`${d.destinationId}.${slot.key}`}
                              text={
                                slot.textTemplate
                                  ? renderTextTemplate(
                                      slot.textTemplate,
                                      product,
                                    )
                                  : undefined
                              }
                              band={textLayerColours(brand)}
                              badge="scene"
                            />
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
                  <strong>
                    {slots.length - scenes.length} of {slots.length}
                  </strong>{" "}
                  {slots.length === 1 ? "frame is" : "frames are"} exact — drawn
                  from the spec, free and final.{" "}
                  {plural(scenes.length, "scene")}{" "}
                  {scenes.length === 1 ? "needs" : "need"} the image model.
                  {off.length > 0
                    ? ` ${off.length} switched off, not part of the deliverable.`
                    : ""}
                </p>
                <p className="font-mono text-[0.7rem] text-on-surface-mid">
                  {estimate
                    ? `≈ ${money(estimate.typical)}–${money(estimate.max)} if each scene is generated once · ${model.model}${estimate.quality ? `, quality ${estimate.quality}` : ""}${estimate.confidence === "derived" ? " (derived price)" : ""}`
                    : `no pinned price for ${model.model}`}
                </p>
                <p className="font-sans text-[0.75rem] text-on-surface-mid">
                  Nothing is generated when you start: each scene waits for your
                  Generate. {REFERENCE_NOTE[product.source.kind]}
                </p>
              </div>
              <Button
                onClick={start}
                disabled={starting}
                className="h-10 rounded-field px-5 font-semibold shadow-button"
              >
                {starting ? <Loader2 className="animate-spin" /> : null}
                Start project <ArrowRight />
              </Button>
            </div>
            {startError ? (
              <p className="font-mono text-[0.7rem] text-prov-local">
                {startError}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="font-sans text-sm text-on-surface-dim">
            The plan appears once a product, a type and a destination are
            chosen.
          </p>
        )}
      </Step>
    </main>
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
          className="font-serif text-xl italic text-foreground"
          style={{ fontVariationSettings: "'opsz' 40" }}
        >
          {title}
        </span>
      </h2>
      {children}
    </section>
  );
}

"use client";

import { ArrowRight, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { createProjectAction } from "@/app/actions/new-project";
import { importProductsAction } from "@/app/actions/products";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { SlotFrame, slotPosition } from "@/components/projects/slot-frame";
import { Button } from "@/components/ui/button";
import { exactView } from "@/domain/exact";
import { estimateScenes } from "@/domain/generation-cost";
import { defaultImageModel } from "@/domain/model-defaults";
import {
  offeredDestinations,
  type ProjectPlan,
  planProject,
} from "@/domain/plan";
import { dimensionsLabel, type Product } from "@/domain/product";
import type { ProjectType } from "@/domain/project";
import { gradientForPrompt } from "@/lib/gradient";
import { PROJECT_TYPES } from "@/lib/project-types";
import { CATALOG } from "@/lib/recipes";
import { cn } from "@/lib/utils";

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

// The New project flow (ROADMAP "Experience design"): three decisions, no text
// field. Every frame of the plan is previewed here; exact ones are already
// final. Start creates the project and opens its board; it calls no model.
export function NewProjectFlow({
  initialProducts,
}: {
  initialProducts: Product[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [productId, setProductId] = useState<string | null>(
    initialProducts.length === 1 ? initialProducts[0].id : null,
  );
  const [type, setType] = useState<BoardType | null>(null);
  const [destinationIds, setDestinationIds] = useState<string[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

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

  const slots = plan?.destinations.flatMap((d) => d.slots) ?? [];
  const scenes = slots.filter((s) => s.fill === "scene");
  const model = defaultImageModel();
  const estimate = estimateScenes(scenes, model);

  function chooseType(next: BoardType) {
    setType(next);
    setDestinationIds(offeredDestinations(next, CATALOG).map((d) => d.id));
  }

  function toggleDestination(id: string) {
    setDestinationIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  async function importFile(file: File) {
    setImporting(true);
    setImportErrors([]);
    try {
      let json: unknown;
      try {
        json = JSON.parse(await file.text());
      } catch {
        setImportErrors([`${file.name} is not valid JSON.`]);
        return;
      }
      const result = await importProductsAction(json);
      if (!result.ok) {
        setImportErrors(result.errors);
        return;
      }
      setProducts((current) => {
        const byId = new Map(current.map((p) => [p.id, p]));
        for (const p of result.products) byId.set(p.id, p);
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
      setProductId(result.products[0]?.id ?? null);
    } catch {
      setImportErrors(["The import failed. Is the database running?"]);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProductId(p.id)}
              className={cn(
                "flex flex-col gap-2 rounded-card bg-card p-5 text-left shadow-card transition-shadow",
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
                {dimensionsLabel(p.dimensions)} · {p.material}
              </span>
              <span className="flex gap-1.5 pt-1">
                {p.colours.map((c) => (
                  <span
                    key={c.key}
                    title={c.name}
                    className="size-4 rounded-swatch border border-border"
                    style={{ backgroundColor: c.face }}
                  />
                ))}
              </span>
            </button>
          ))}
          <div className="flex flex-col justify-center gap-2 rounded-card border border-dashed border-border bg-card/60 p-5">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
              className="self-start"
            >
              {importing ? <Loader2 className="animate-spin" /> : <FileUp />}
              Import products (.json)
            </Button>
            <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
              A product package: one product, a list, or {"{ products: [...] }"}
              , in the Product schema. Re-importing a SKU updates it.
            </p>
          </div>
        </div>
        {importErrors.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 rounded-field bg-prov-local/10 px-4 py-3 font-mono text-[0.7rem] text-prov-local">
            {importErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
      </Step>

      {/* 2 · Type */}
      <Step n={2} title="Type" muted={!product}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROJECT_TYPES.map((t) =>
            t.type === "design" ? (
              <Link
                key={t.type}
                href="/?new=1"
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
                    {destination.name} · {d.slots.length} frames
                  </h3>
                  <div className="flex gap-5 overflow-x-auto pb-3">
                    {d.slots.map((slot, i) => (
                      <SlotFrame
                        key={slot.key}
                        position={slotPosition(destination, i)}
                        label={slot.label}
                        purpose={slot.purpose}
                        aspect={slot.aspect}
                        view={{
                          state: slot.fill === "exact" ? "exact" : "queued",
                          failed: false,
                        }}
                      >
                        {slot.exact ? (
                          <ExactSlotArt
                            view={exactView(
                              slot.exact,
                              product,
                              slot.textTemplate,
                            )}
                            aspect={slot.aspect}
                          />
                        ) : (
                          <div
                            className="flex h-full w-full items-end p-3"
                            style={{
                              backgroundImage: gradientForPrompt(
                                `${d.destinationId}.${slot.key}`,
                              ),
                            }}
                          >
                            <span className="rounded-pill bg-card/85 px-2 py-0.5 font-mono text-[0.59rem] text-on-surface-mid">
                              scene
                            </span>
                          </div>
                        )}
                      </SlotFrame>
                    ))}
                  </div>
                </section>
              );
            })}

            <div className="flex flex-col gap-4 rounded-card bg-card p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1.5">
                <p className="font-sans text-sm text-foreground">
                  <strong>
                    {slots.length - scenes.length} of {slots.length}
                  </strong>{" "}
                  frames are exact — drawn from the spec, free and final.{" "}
                  {scenes.length} scenes need the image model.
                </p>
                <p className="font-mono text-[0.7rem] text-on-surface-mid">
                  {estimate
                    ? `≈ ${money(estimate.typical)}–${money(estimate.max)} if each scene is generated once · ${model.model}, quality auto${estimate.confidence === "derived" ? " (derived price)" : ""}`
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

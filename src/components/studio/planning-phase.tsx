"use client";

import { ImageIcon, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { proposeVariants } from "@/app/actions/art-direct";
import {
  PaletteSwatches,
  parseHexList,
} from "@/components/studio/palette-swatches";
import { ProvenanceBadge } from "@/components/studio/provenance-badge";
import { Input } from "@/components/ui/input";
import type { FieldKey } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForPrompt } from "@/lib/gradient";
import { SEED_RECIPES } from "@/lib/recipes";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";

// The five editable rows, in cascade/prompt order, with their UI labels.
const ROWS: { key: FieldKey; label: string }[] = [
  { key: "subject", label: "Subject" },
  { key: "materials", label: "Materials" },
  { key: "scene", label: "Scene" },
  { key: "composition", label: "Composition" },
  { key: "lighting", label: "Lighting" },
  { key: "mood", label: "Mood" },
  { key: "palette", label: "Palette" },
];

// Compact inline thumbnail for the recipe-context card (56px). Shows the real
// master — uploaded blob OR generated storage URL — whenever it's renderable;
// falls back to a deterministic gradient only for non-resolving stub (mock) URLs.
function ContextThumb({ master }: { master: MasterAsset }) {
  if (isRenderableUrl(master.assetUrl)) {
    return (
      // biome-ignore lint/performance/noImgElement: durable storage/blob URL, not using next/image in this studio
      <img
        src={master.assetUrl}
        alt="Master asset"
        className="size-14 flex-shrink-0 rounded-thumb object-cover shadow-render"
      />
    );
  }
  return (
    <div
      className="size-14 flex-shrink-0 rounded-thumb shadow-render"
      style={{ backgroundImage: gradientForPrompt(master.sourcePrompt ?? "") }}
    />
  );
}

// One editable product-context row (product-level understanding, not a card field).
function ContextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-border-soft border-b py-3 last:border-b-0">
      <div className="w-[104px] flex-shrink-0 font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
        {label}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 flex-1 rounded-field border-border bg-secondary font-sans text-sm text-foreground"
      />
    </div>
  );
}

export function PlanningPhase({ master }: { master: MasterAsset }) {
  const recipeId = useWorkspace((s) => s.recipeId);
  const planning = useWorkspace((s) => s.planning);
  const selectRecipe = useWorkspace((s) => s.selectRecipe);
  const editPlanningField = useWorkspace((s) => s.editPlanningField);
  const editUnderstandingField = useWorkspace((s) => s.editUnderstandingField);
  const generateVariants = useWorkspace((s) => s.generateVariants);
  const understanding = useWorkspace((s) => s.understanding);
  const [busy, setBusy] = useState(false);

  // Guard: planning is always set on entry (goToPlanning), but stay defensive.
  if (planning === null) return null;

  // Ask the ArtDirector (Gemini text) for diverse per-direction scenes, then build
  // the cards. Line-art recipes skip it (its photographic scenes don't apply — the
  // slot purpose drives each variant). Falls back to shared planning on no key/error.
  async function handleGenerate() {
    const recipe = SEED_RECIPES.find((r) => r.id === recipeId);
    if (!recipeId || !understanding || recipe?.style === "line-art") {
      generateVariants();
      return;
    }
    setBusy(true);
    try {
      const variants = await proposeVariants({ understanding, recipeId });
      generateVariants(variants);
    } catch {
      generateVariants();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-11 sm:px-8">
      <h2
        className="font-serif text-[1.625rem] font-semibold leading-tight text-foreground"
        style={{ fontVariationSettings: "'opsz' 144" }}
      >
        Plan the production
      </h2>
      <p className="mt-1 mb-6 max-w-[560px] font-sans text-[0.84375rem] leading-relaxed text-on-surface-mid">
        Pick a recipe, then tune the shared context. Each field carries a
        provenance badge showing where its value came from — edit any of them
        and it becomes locally yours.
      </p>

      <div className="mb-7 flex flex-wrap gap-2.5">
        {SEED_RECIPES.map((recipe) => {
          const selected = recipe.id === recipeId;
          return (
            <button
              key={recipe.id}
              type="button"
              onClick={() => selectRecipe(recipe.id)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-card border px-4 py-3 text-left transition-colors",
                selected
                  ? "border-primary bg-card shadow-card"
                  : "border-border bg-transparent hover:border-border-soft",
              )}
            >
              <span className="font-serif text-[0.9375rem] italic text-foreground">
                {recipe.name}
              </span>
              <span className="font-mono text-[0.6875rem] text-on-surface-dim">
                {recipe.targets.map((t) => t.aspect).join(" · ")} ·{" "}
                {recipe.directions.length} shots
              </span>
            </button>
          );
        })}
      </div>

      {understanding ? (
        <div className="mb-5 rounded-card bg-card p-6 shadow-card">
          <div className="font-sans text-sm font-semibold text-foreground">
            Product context
          </div>
          <p className="mt-1 mb-4 max-w-[560px] font-sans text-[0.78125rem] leading-relaxed text-on-surface-mid">
            How Kiln reads your product — this drives the lifestyle scenes and
            keeps any mount or prop out of the hero. Fix anything the analysis
            got wrong.
          </p>
          <div className="flex flex-col">
            <ContextRow
              label="Product type"
              value={understanding.productType}
              onChange={(v) => editUnderstandingField("productType", v)}
              placeholder="e.g. door hanger sign"
            />
            <ContextRow
              label="Where it's used"
              value={understanding.useContext}
              onChange={(v) => editUnderstandingField("useContext", v)}
              placeholder="e.g. hangs on a door handle or knob"
            />
            <ContextRow
              label="Props in photo"
              value={understanding.sceneProps}
              onChange={(v) => editUnderstandingField("sceneProps", v)}
              placeholder="what's NOT the product — e.g. hooked over a door handle; empty if shot alone"
            />
          </div>
        </div>
      ) : null}

      <div className="rounded-card bg-card p-6 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <ContextThumb master={master} />
          <div>
            <div className="font-sans text-sm font-semibold text-foreground">
              Recipe context
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[0.6875rem] text-on-surface-dim">
              <ImageIcon className="size-3" />
              base: {master.origin}
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          {ROWS.map(({ key, label }) => {
            const field = planning[key];
            return (
              <div
                key={key}
                className="flex items-center gap-3 border-b border-border-soft py-3 last:border-b-0"
              >
                <div className="w-[88px] flex-shrink-0 font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
                  {label}
                </div>
                {key === "palette" ? (
                  <div className="flex min-h-9 flex-1 items-center gap-3">
                    <Input
                      value={field.value}
                      onChange={(e) => editPlanningField(key, e.target.value)}
                      className="h-9 flex-1 rounded-field border-border bg-secondary font-sans text-sm text-foreground"
                    />
                    <PaletteSwatches colors={parseHexList(field.value)} />
                  </div>
                ) : (
                  <Input
                    value={field.value}
                    onChange={(e) => editPlanningField(key, e.target.value)}
                    className="h-9 flex-1 rounded-field border-border bg-secondary font-sans text-sm text-foreground"
                  />
                )}
                <ProvenanceBadge
                  source={field.source}
                  className="flex-shrink-0"
                />
              </div>
            );
          })}
        </div>

        <p className="mt-4 font-sans text-[0.78125rem] leading-relaxed text-on-surface-mid">
          Edit any field in any language — your wording wins over the recipe and
          brand defaults. Image-sourced fields stay pinned to what the photo
          showed unless you override them here.
        </p>
      </div>

      <div className="mt-7">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="inline-flex w-fit items-center gap-2 rounded-field bg-primary px-5 py-[11px] font-sans text-sm font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="size-[15px] animate-spin" /> Directing
              variants…
            </>
          ) : (
            <>
              <Sparkles className="size-[15px]" /> Generate variants
            </>
          )}
        </button>
      </div>
    </div>
  );
}

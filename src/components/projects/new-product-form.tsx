"use client";

import {
  ChevronDown,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { DropdownMenu, ToggleGroup } from "radix-ui";
import { useRef, useState, useTransition } from "react";
import {
  createProductAction,
  draftProductAction,
  uploadProductFileAction,
} from "@/app/actions/products";
import { MaterialCombobox } from "@/components/projects/material-combobox";
import {
  emptyWordingRow,
  type WordingRow,
  WordingRows,
} from "@/components/projects/wording-rows";
import { DegradedNotice } from "@/components/studio/degraded-notice";
import { Button } from "@/components/ui/button";
import type { Product, Treatment, Unit, ViewLabel } from "@/domain/product";
import {
  counter,
  ratioCheck,
  sizePreview,
  stillNeeded,
} from "@/lib/product-checks";
import { FINISHES, formIssues, type ProductForm } from "@/lib/product-form";
import { cn } from "@/lib/utils";
import type { StoredProductFile } from "@/server/product-files";
import type { Degraded } from "@/server/text-calls";

const LABEL =
  "font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const FIELD =
  "h-9 w-full min-w-0 rounded-field border border-border bg-secondary px-3 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";

const round = (n: number) => Math.round(n * 100) / 100;

const NOTE = "font-sans text-[0.75rem] text-on-surface-mid";

// A field's label, with its count once it nears the limit.
function Label({
  text,
  value,
  limit,
}: {
  text: string;
  value?: string;
  limit?: number;
}) {
  const count = value !== undefined && limit ? counter(value, limit) : null;
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className={LABEL}>{text}</span>
      {count ? (
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          {count}
        </span>
      ) : null}
    </span>
  );
}

const VIEW_LABELS: { value: ViewLabel; label: string }[] = [
  { value: "side", label: "Side" },
  { value: "top", label: "Top" },
  { value: "back", label: "Back" },
  { value: "three-quarter", label: "Three-quarter" },
];
const viewName = (label: ViewLabel) =>
  VIEW_LABELS.find((v) => v.value === label)?.label ?? label;

interface Colour {
  name: string;
  hex: string;
  // A photo of the material in this colour: it travels with the reference
  // to the image model.
  swatchUrl?: string;
}

// New product (New project, step 1): what a maker knows about a piece, on one
// screen. A photo or a design file is optional: it prefills the colours (free)
// and, for a design, the height from its proportions; a photo can fill the
// rest with the maker's text model (priced, on a click). Saving runs the
// import's checks and selects the product.
export function NewProductForm({
  materials,
  draftPrice,
  initialFile,
  onCreated,
  onCancel,
}: {
  // The maker's materials so far, as suggestions.
  materials: string[];
  // "≈ $0.03" for "Fill from the photo" on the maker's text model.
  draftPrice: string | null;
  // A design handed over from the studio ("Make it a product").
  initialFile?: StoredProductFile | null;
  onCreated: (product: Product, warning?: string) => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<StoredProductFile | null>(
    initialFile ?? null,
  );
  const [name, setName] = useState("");
  const [whatItIs, setWhatItIs] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [unit, setUnit] = useState<Unit>("in");
  const [material, setMaterial] = useState("");
  const [treatment, setTreatment] = useState<Treatment>("engraved");
  const [colours, setColours] = useState<Colour[]>(
    initialFile?.colours.length
      ? initialFile.colours
      : [{ name: "Natural", hex: "#D9B98C" }],
  );
  const [wording, setWording] = useState<WordingRow[]>([]);
  const [useContext, setUseContext] = useState("");
  const [price, setPrice] = useState("");
  // Up to two more views of the piece (the front one is the reference).
  const [views, setViews] = useState<{ label: ViewLabel; url: string }[]>([]);
  const viewInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  // After the first Save, each field shows its problem as it is fixed.
  const [attempted, setAttempted] = useState(false);
  const [degraded, setDegraded] = useState<Degraded | null>(null);
  const [uploading, startUpload] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const sampleInput = useRef<HTMLInputElement>(null);
  // The colour row a material photo is being chosen for.
  const sampleRow = useRef<number | null>(null);

  const ratio = file?.kind === "vector" ? file.ratio : null;
  const busy = uploading || drafting || saving;

  function setWidthFollowing(value: string) {
    setWidth(value);
    const w = Number(value);
    if (ratio && w > 0) setHeight(String(round(w / ratio)));
  }

  function upload(chosen: File) {
    setError(null);
    startUpload(async () => {
      const data = new FormData();
      data.set("file", chosen);
      const result = await uploadProductFileAction(data);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setFile(result);
      if (result.colours.length > 0) setColours(result.colours);
      const w = Number(width);
      if (result.kind === "vector" && w > 0) {
        setHeight(String(round(w / result.ratio)));
      }
    });
  }

  // A colour's material photo: stored like the product photo; its dominant
  // colour becomes the swatch's hex (the maker can change it).
  function uploadSample(row: number, chosen: File) {
    setError(null);
    startUpload(async () => {
      const data = new FormData();
      data.set("file", chosen);
      const result = await uploadProductFileAction(data);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.kind !== "photo") {
        setError("A material sample is a photo (PNG, JPEG or WebP).");
        return;
      }
      setColours((all) =>
        all.map((x, j) =>
          j === row
            ? {
                ...x,
                swatchUrl: result.url,
                hex: result.colours[0]?.hex ?? x.hex,
              }
            : x,
        ),
      );
    });
  }

  // Another view: a photo, or an SVG drawing (rendered to PNG on save).
  function uploadView(chosen: File) {
    setError(null);
    startUpload(async () => {
      const data = new FormData();
      data.set("file", chosen);
      const result = await uploadProductFileAction(data);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // The first side not shown yet; the maker can change it beside the
      // thumbnail.
      setViews((all) => {
        const taken = new Set(all.map((v) => v.label));
        const label =
          VIEW_LABELS.find((v) => !taken.has(v.value))?.value ?? "side";
        return [...all, { label, url: result.url }];
      });
    });
  }

  function fill(model?: { provider: "google" | "openai"; model: string }) {
    if (file?.kind !== "photo") return;
    setError(null);
    startDraft(async () => {
      const result = await draftProductAction({ assetUrl: file.url, model });
      if (result.error) setError(result.error);
      setDegraded(result.degraded ?? null);
      const draft = result.draft;
      if (!draft) return;
      setName(draft.name);
      setWhatItIs(draft.whatItIs);
      setMaterial(draft.material);
      setTreatment(draft.treatment);
      if (draft.colours.length > 0) setColours(draft.colours);
      setWording(
        draft.wording.map((w) => ({
          ...emptyWordingRow(),
          label: w.label,
          example: w.example,
        })),
      );
      setUseContext(draft.useContext);
    });
  }

  // What Save sends: the form's state as the schema reads it.
  function formInput(): ProductForm {
    return {
      name,
      whatItIs,
      width: Number(width),
      height: Number(height),
      unit,
      material,
      treatment,
      colours,
      wording: wording
        .filter((w) => w.label.trim() || w.example.trim())
        .map((w) => ({
          label: w.label,
          ...(w.example.trim() ? { example: w.example } : {}),
          maxChars: Number(w.maxChars) > 0 ? Number(w.maxChars) : null,
          required: !w.optional,
        })),
      ...(useContext.trim() ? { useContext } : {}),
      ...(Number(price) > 0 ? { price: Number(price) } : {}),
      views,
      ...(file
        ? {
            file:
              file.kind === "vector"
                ? {
                    kind: "vector",
                    url: file.url,
                    drawnWidthPx: file.drawnWidthPx,
                  }
                : { kind: "photo", url: file.url },
          }
        : {}),
    };
  }

  function save() {
    setError(null);
    setAttempted(true);
    const first = formIssues(formInput())[0];
    if (first) {
      const at = document.querySelector<HTMLElement>(
        `[data-field="${first.path}"]`,
      );
      at?.scrollIntoView({ block: "center" });
      at?.focus({ preventScroll: true });
      return;
    }
    startSave(async () => {
      const result = await createProductAction(formInput());
      if ("error" in result) setError(result.error);
      else onCreated(result.product, result.warning);
    });
  }

  const preview = sizePreview(Number(width), Number(height), unit);
  const ratioNote = ratioCheck(ratio, Number(width), Number(height));
  const needed = stillNeeded(formInput());
  const problems = Object.fromEntries(
    (attempted ? formIssues(formInput()) : []).map((i) => [i.path, i.message]),
  );
  const problem = (...paths: string[]) => {
    const message = paths.map((p) => problems[p]).find(Boolean);
    return message ? (
      <span className="font-sans text-[0.75rem] text-prov-local">
        {message}
      </span>
    ) : null;
  };

  return (
    <div className="col-span-full flex flex-col gap-5 rounded-card bg-card p-6 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            className="font-serif text-xl italic text-foreground"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            New product
          </h3>
          <p className="mt-1 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            Tell Kiln what the piece is. A photo becomes the reference every
            scene starts from; a design file (SVG) is drawn to scale, so you can
            plan the listing before it is made.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          disabled={busy}
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>

      {/* The file: optional. */}
      <div className="flex flex-wrap items-center gap-4">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) upload(chosen);
            e.target.value = "";
          }}
        />
        {file ? (
          <div className="flex items-center gap-3">
            <div className="size-16 flex-shrink-0 overflow-hidden rounded-thumb bg-surface-soft shadow-render">
              {/* biome-ignore lint/performance/noImgElement: a stored upload, shown as is */}
              <img
                src={file.url}
                alt=""
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-sans text-[0.8rem] text-foreground">
                {file.kind === "vector"
                  ? "Design file: drawn to scale, height follows its proportions"
                  : "Photo: the reference for every scene"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => setFile(null)}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="flex items-center gap-3 rounded-render border border-dashed border-border bg-surface-soft px-4 py-3 text-left transition-colors hover:border-primary disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin text-on-surface-mid" />
            ) : (
              <ImagePlus className="size-5 text-on-surface-mid" />
            )}
            <span className="flex flex-col">
              <span className="font-sans text-sm font-semibold text-foreground">
                Add a photo or design file
              </span>
              <span className="font-sans text-[0.75rem] text-on-surface-mid">
                Optional · PNG, JPEG, WebP or SVG, up to 15 MB
              </span>
            </span>
          </button>
        )}
        {file?.kind === "photo" ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => fill()}
          >
            {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Fill from the photo{draftPrice ? ` · ${draftPrice}` : ""}
          </Button>
        ) : null}
      </div>

      {degraded ? (
        <DegradedNotice
          degraded={degraded}
          fellBackTo="nothing: the form is as you left it"
          verb="Fill it"
          pending={drafting}
          onAlternative={(model) => fill(model)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <Label text="Name" value={name} limit={80} />
          <input
            data-field="name"
            className={FIELD}
            value={name}
            placeholder="Engraved family cutting board"
            onChange={(e) => setName(e.target.value)}
          />
          {problem("name")}
        </label>
        <label className="flex flex-col gap-1.5">
          <Label text="What it is" value={whatItIs} limit={60} />
          <input
            data-field="whatItIs"
            className={FIELD}
            value={whatItIs}
            placeholder="cutting board, round coaster…"
            onChange={(e) => setWhatItIs(e.target.value)}
          />
          {problem("whatItIs")}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Size</span>
          <div className="flex items-center gap-2">
            <input
              aria-label="Width"
              data-field="width"
              className={FIELD}
              inputMode="decimal"
              value={width}
              placeholder="width"
              onChange={(e) => setWidthFollowing(e.target.value)}
            />
            <span className="font-sans text-sm text-on-surface-mid">×</span>
            <input
              aria-label="Height"
              data-field="height"
              className={FIELD}
              inputMode="decimal"
              value={height}
              placeholder="height"
              onChange={(e) => setHeight(e.target.value)}
            />
            <ToggleGroup.Root
              type="single"
              aria-label="Unit"
              value={unit}
              onValueChange={(next) => {
                if (next) setUnit(next as Unit);
              }}
              className="flex flex-shrink-0 gap-1 rounded-field bg-secondary p-1"
            >
              {(["in", "mm"] as const).map((u) => (
                <ToggleGroup.Item
                  key={u}
                  value={u}
                  className={cn(
                    "h-7 rounded-[9px] px-2.5 font-sans text-[0.8rem] transition-colors",
                    unit === u
                      ? "bg-primary text-primary-foreground"
                      : "text-on-surface-mid hover:bg-surface-soft",
                  )}
                >
                  {u}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>
          {problem("width", "height")}
          {preview ? (
            <span className="font-mono text-[0.7rem] text-on-surface-mid">
              {preview}
            </span>
          ) : null}
          {ratioNote ? (
            <span className="font-sans text-[0.75rem] text-prov-local">
              {ratioNote}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label text="Material" value={material} limit={60} />
          <MaterialCombobox
            label="Material"
            value={material}
            onChange={setMaterial}
            options={materials}
            field={FIELD}
            placeholder="solid walnut, glazed stoneware…"
          />
          {problem("material") ?? (
            <span className="font-sans text-[0.75rem] text-on-surface-mid">
              Pick one you've used or type a new one.
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Finish</span>
        <div className="flex flex-wrap gap-2">
          {FINISHES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTreatment(f.value)}
              className={cn(
                "rounded-field px-3 py-1.5 font-sans text-[0.8rem] transition-colors",
                treatment === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground hover:bg-surface-soft",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="font-sans text-[0.75rem] text-on-surface-mid">
          {FINISHES.find((f) => f.value === treatment)?.hint}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Colours</span>
        <div className="flex flex-col gap-2">
          {colours.map((c, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
              key={i}
              className="flex items-center gap-2"
            >
              <input
                type="color"
                aria-label={`Colour ${i + 1}`}
                value={c.hex}
                onChange={(e) =>
                  setColours((all) =>
                    all.map((x, j) =>
                      j === i ? { ...x, hex: e.target.value.toUpperCase() } : x,
                    ),
                  )
                }
                className="size-9 flex-shrink-0 cursor-pointer rounded-swatch border border-border bg-transparent"
              />
              <input
                aria-label={`Colour ${i + 1} name`}
                data-field={`colours.${i}.name`}
                className={cn(FIELD, "max-w-[260px]")}
                value={c.name}
                onChange={(e) =>
                  setColours((all) =>
                    all.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
              {c.swatchUrl ? (
                <span className="relative flex-shrink-0">
                  {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
                  <img
                    src={c.swatchUrl}
                    alt={`${c.name || `Colour ${i + 1}`} material`}
                    className="size-9 rounded-swatch border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove the material photo"
                    onClick={() =>
                      setColours((all) =>
                        all.map((x, j) =>
                          j === i ? { ...x, swatchUrl: undefined } : x,
                        ),
                      )
                    }
                    className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-pill bg-card text-on-surface-mid shadow-render hover:text-foreground"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  title="A close photo of the material in this colour, even light, no text: scenes copy its look"
                  onClick={() => {
                    sampleRow.current = i;
                    sampleInput.current?.click();
                  }}
                >
                  <ImagePlus /> Material photo
                </Button>
              )}
              {i === 0 ? (
                <span className="font-mono text-[0.625rem] text-on-surface-dim">
                  default
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove colour"
                  onClick={() =>
                    setColours((all) => all.filter((_, j) => j !== i))
                  }
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          <input
            ref={sampleInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              const row = sampleRow.current;
              if (chosen && row !== null) uploadSample(row, chosen);
              e.target.value = "";
            }}
          />
          {colours.map((_, i) =>
            problems[`colours.${i}.name`] ? (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: one note per row
                key={i}
                className="font-sans text-[0.75rem] text-prov-local"
              >
                Colour {i + 1}: {problems[`colours.${i}.name`]}
              </span>
            ) : null,
          )}
          {colours.length < 8 ? (
            <Button
              variant="ghost"
              size="xs"
              className="self-start"
              onClick={() =>
                setColours((all) => [...all, { name: "", hex: "#808080" }])
              }
            >
              <Plus /> Add colour
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={LABEL}>Text the buyer personalizes</span>
          <WordingRows
            rows={wording}
            field={FIELD}
            onChange={setWording}
            problems={problems}
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Where it's used (optional)</span>
          <input
            className={FIELD}
            value={useContext}
            placeholder="a kitchen counter"
            onChange={(e) => setUseContext(e.target.value)}
          />
          <span className="font-sans text-[0.75rem] text-on-surface-mid">
            The in-use and lifestyle scenes take place there.
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Price (optional)</span>
          <input
            className={cn(FIELD, "max-w-[160px]")}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={price}
            placeholder="24.00"
            onChange={(e) => setPrice(e.target.value)}
          />
          <span className="font-sans text-[0.75rem] text-on-surface-mid">
            Yours, in your shop's currency. The listing text needs it; Kiln
            never sets one.
          </span>
        </label>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={LABEL}>Another view (optional)</span>
          <div className="flex flex-wrap items-center gap-2">
            {views.map((v, i) => (
              <span
                key={v.url}
                className="flex items-center gap-2 rounded-field bg-surface-soft py-1 pr-1 pl-1"
              >
                {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
                <img
                  src={v.url}
                  alt={`${viewName(v.label)} view`}
                  className="size-9 rounded-swatch object-cover"
                />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`Which view: ${viewName(v.label)}`}
                      className="inline-flex items-center gap-1 rounded-[9px] px-1.5 py-1 font-sans text-[0.8rem] text-foreground hover:bg-secondary"
                    >
                      {viewName(v.label)}
                      <ChevronDown className="size-3 text-on-surface-mid" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="start"
                      sideOffset={4}
                      className="z-50 min-w-[9rem] rounded-field bg-card p-1 shadow-card ring-1 ring-border"
                    >
                      {VIEW_LABELS.map((option) => (
                        <DropdownMenu.Item
                          key={option.value}
                          disabled={views.some(
                            (other, j) =>
                              j !== i && other.label === option.value,
                          )}
                          onSelect={() =>
                            setViews((all) =>
                              all.map((x, j) =>
                                j === i ? { ...x, label: option.value } : x,
                              ),
                            )
                          }
                          className="cursor-pointer rounded-[9px] px-2.5 py-1.5 font-sans text-sm text-foreground outline-none data-[disabled]:cursor-default data-[disabled]:text-on-surface-dim data-[highlighted]:bg-secondary"
                        >
                          {option.label}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <button
                  type="button"
                  aria-label={`Remove the ${viewName(v.label)} view`}
                  onClick={() =>
                    setViews((all) => all.filter((_, j) => j !== i))
                  }
                  className="p-1 text-on-surface-mid hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {views.length < 2 ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => viewInput.current?.click()}
              >
                <ImagePlus /> Add a view
              </Button>
            ) : null}
          </div>
          <input
            ref={viewInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) uploadView(chosen);
              e.target.value = "";
            }}
          />
          <span className="font-sans text-[0.75rem] text-on-surface-mid">
            {treatment === "raised" && !views.some((v) => v.label === "side")
              ? "A side view shows how far the marks stand out; scenes read it beside the front."
              : "What the front cannot show — the side, the top of a base. A photo or an SVG drawing."}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border-soft pt-4">
        <Button
          disabled={busy}
          onClick={save}
          className="h-10 rounded-field px-5 font-semibold shadow-button"
        >
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save product
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {needed.length > 0 ? (
          <span className={NOTE}>Still needed: {needed.join(", ")}.</span>
        ) : null}
        <span className="font-sans text-[0.75rem] text-on-surface-mid">
          Only an idea so far?{" "}
          <Link href="/studio?new=1" className="font-semibold text-primary">
            Draw it first
          </Link>
          , then make the design a product.
        </span>
        {error ? (
          <span className="w-full font-mono text-[0.7rem] text-prov-local">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

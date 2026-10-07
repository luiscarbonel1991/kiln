"use client";

import { ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  createProductAction,
  draftProductAction,
  uploadProductFileAction,
} from "@/app/actions/products";
import { DegradedNotice } from "@/components/studio/degraded-notice";
import { Button } from "@/components/ui/button";
import type { Product, Treatment, Unit } from "@/domain/product";
import { FINISHES } from "@/lib/product-form";
import { cn } from "@/lib/utils";
import type { StoredProductFile } from "@/server/product-files";
import type { Degraded } from "@/server/text-calls";

const LABEL =
  "font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const FIELD =
  "h-9 w-full min-w-0 rounded-field border border-border bg-secondary px-3 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";

const round = (n: number) => Math.round(n * 100) / 100;

interface Colour {
  name: string;
  hex: string;
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
  const [wording, setWording] = useState<{ label: string; example: string }[]>(
    [],
  );
  const [useContext, setUseContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<Degraded | null>(null);
  const [uploading, startUpload] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();
  const input = useRef<HTMLInputElement>(null);

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
      setWording(draft.wording);
      setUseContext(draft.useContext);
    });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const result = await createProductAction({
        name,
        whatItIs,
        width: Number(width),
        height: Number(height),
        unit,
        material,
        treatment,
        colours,
        wording: wording
          .filter((w) => w.label.trim())
          .map((w) => ({
            label: w.label,
            ...(w.example.trim() ? { example: w.example } : {}),
          })),
        ...(useContext.trim() ? { useContext } : {}),
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
      });
      if ("error" in result) setError(result.error);
      else onCreated(result.product, result.warning);
    });
  }

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
          <span className={LABEL}>Name</span>
          <input
            className={FIELD}
            value={name}
            placeholder="Engraved family cutting board"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>What it is</span>
          <input
            className={FIELD}
            value={whatItIs}
            placeholder="cutting board, round coaster…"
            onChange={(e) => setWhatItIs(e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Size</span>
          <div className="flex items-center gap-2">
            <input
              aria-label="Width"
              className={FIELD}
              inputMode="decimal"
              value={width}
              placeholder="width"
              onChange={(e) => setWidthFollowing(e.target.value)}
            />
            <span className="font-sans text-sm text-on-surface-mid">×</span>
            <input
              aria-label="Height"
              className={FIELD}
              inputMode="decimal"
              value={height}
              placeholder="height"
              onChange={(e) => setHeight(e.target.value)}
            />
            <select
              aria-label="Unit"
              className={cn(FIELD, "w-[4.75rem] flex-shrink-0 px-2")}
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
            >
              <option value="in">in</option>
              <option value="mm">mm</option>
            </select>
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Material</span>
          <input
            className={FIELD}
            list="kiln-materials"
            value={material}
            placeholder="solid walnut, glazed stoneware…"
            onChange={(e) => setMaterial(e.target.value)}
          />
          <datalist id="kiln-materials">
            {materials.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
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
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Text the buyer personalizes</span>
          {wording.map((w, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
              key={i}
              className="flex items-center gap-2"
            >
              <input
                aria-label="What the buyer writes"
                className={FIELD}
                value={w.label}
                placeholder="Family name"
                onChange={(e) =>
                  setWording((all) =>
                    all.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label="Example"
                className={FIELD}
                value={w.example}
                placeholder="The Johnsons"
                onChange={(e) =>
                  setWording((all) =>
                    all.map((x, j) =>
                      j === i ? { ...x, example: e.target.value } : x,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove line"
                onClick={() =>
                  setWording((all) => all.filter((_, j) => j !== i))
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {wording.length < 3 ? (
            <Button
              variant="ghost"
              size="xs"
              className="self-start"
              onClick={() =>
                setWording((all) => [...all, { label: "", example: "" }])
              }
            >
              <Plus />{" "}
              {wording.length === 0 ? "Add a line (optional)" : "Add a line"}
            </Button>
          ) : null}
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
        <span className="font-sans text-[0.75rem] text-on-surface-mid">
          Only an idea so far?{" "}
          <Link href="/?new=1" className="font-semibold text-primary">
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

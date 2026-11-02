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
  reviewProductAction,
  updateProductAction,
  uploadProductFileAction,
} from "@/app/actions/products";
import { MaterialCheck } from "@/components/projects/material-check";
import { MaterialCombobox } from "@/components/projects/material-combobox";
import {
  type Details,
  emptyDetails,
  MoreDetails,
} from "@/components/projects/more-details";
import { PlacesOfUse } from "@/components/projects/places-of-use";
import {
  ProductStyles,
  type StyleRow,
} from "@/components/projects/product-styles";
import { ReviewNote } from "@/components/projects/review-note";
import {
  emptyWordingRow,
  type WordingRow,
  WordingRows,
} from "@/components/projects/wording-rows";
import {
  DegradedNotice,
  RanOnNotice,
} from "@/components/studio/degraded-notice";
import { Button } from "@/components/ui/button";
import { FilePick } from "@/components/ui/file-pick";
import { MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { contrastInk } from "@/domain/exact";
import type { RanOn } from "@/domain/model-routing";
import {
  type Product,
  Treatment,
  type Unit,
  type ViewLabel,
} from "@/domain/product";
import { plural } from "@/lib/plural";
import {
  counter,
  ratioCheck,
  sizePreview,
  stillNeeded,
} from "@/lib/product-checks";
import {
  FINISHES,
  FORM_LIMITS,
  type FormLimits,
  formIssues,
  type ProductForm,
} from "@/lib/product-form";
import {
  type CleanReview,
  MAX_PLACES,
  type ReviewForm,
  reviewFields,
  type Suggestion,
} from "@/lib/product-review";
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

const PRODUCT_FILE_TYPES = "image/png,image/jpeg,image/webp,image/svg+xml,.svg";

interface Colour {
  // The stored colour this row edits (absent for a new one).
  key?: string;
  name: string;
  hex: string;
  // A photo of the material in this colour: it travels with the reference
  // to the image model.
  swatchUrl?: string;
  // A layered finish: the base that shows through the cuts.
  base?: string;
  // The supplier's page for this colour.
  supplierUrl?: string;
}

// A layered colour's base until the maker picks one: readable on its face.
const baseOf = (c: Colour) => c.base ?? contrastInk(c.hex).toUpperCase();

export type SavedProduct = Extract<
  Awaited<ReturnType<typeof updateProductAction>>,
  { product: Product }
>;

// The form's file as the editor holds it.
function storedFile(form: ProductForm): StoredProductFile | null {
  const file = form.file;
  if (!file) return null;
  return file.kind === "photo"
    ? { kind: "photo", url: file.url, colours: [] }
    : {
        kind: "vector",
        url: file.url,
        colours: [],
        drawnWidthPx: file.drawnWidthPx ?? 0,
        ratio: form.width / form.height,
      };
}

const text = (n: number | undefined | null) => (n ? String(n) : "");

// "GPT-6.1 Sol: 2 suggestions and 1 check, under their fields."
function reviewSummary(model: string, suggestions: number, checks: number) {
  if (suggestions + checks === 0)
    return `${model} has nothing more to suggest.`;
  const counts = [
    suggestions > 0 ? plural(suggestions, "suggestion") : null,
    checks > 0 ? plural(checks, "check") : null,
  ].filter(Boolean);
  const where = suggestions + checks === 1 ? "its field" : "their fields";
  return `${model}: ${counts.join(" and ")}, under ${where}. Nothing is saved until you save.`;
}

// The review's fields that live under More details.
const DETAIL_FIELDS = new Set(["hook", "cta", "description"]);

// The colour a new product starts with, until the maker names its own.
const STARTER_COLOUR: Colour = { name: "Natural", hex: "#D9B98C" };

// A product's editor: what a maker knows about a piece, on one screen. New
// (New project, step 1): a photo or a design file is optional, it prefills
// the colours (free) and, for a design, the height from its proportions; a
// photo can fill the rest with the maker's text model (priced, on a click).
// Editing: the same form, opened on the saved product; saving lays it over
// the product (what the form does not show is kept). Either runs the
// import's checks.
export function ProductEditor({
  materials,
  families = [],
  draftPrice,
  reviewPrice,
  initialFile,
  onCreated,
  onCancel,
  editing,
  onSaved,
}: {
  // The maker's materials so far, as suggestions.
  materials: string[];
  // The maker's product families so far, as suggestions.
  families?: string[];
  // "≈ $0.03" for "Fill from the photo" on the maker's text model.
  draftPrice: string | null;
  // "≈ $0.03" for "Review with AI" on the maker's text model.
  reviewPrice: string | null;
  // A design handed over from the studio ("Make it a product").
  initialFile?: StoredProductFile | null;
  onCreated?: (product: Product, warning?: string) => void;
  onCancel: () => void;
  // A saved product being edited: its form and its text limits.
  editing?: { productId: string; form: ProductForm; limits: FormLimits };
  onSaved?: (saved: SavedProduct) => void;
}) {
  const start = editing?.form;
  const limits = editing?.limits ?? FORM_LIMITS;
  const [file, setFile] = useState<StoredProductFile | null>(
    start ? storedFile(start) : (initialFile ?? null),
  );
  const [name, setName] = useState(start?.name ?? "");
  const [whatItIs, setWhatItIs] = useState(start?.whatItIs ?? "");
  const [family, setFamily] = useState(start?.family ?? "");
  const [width, setWidth] = useState(text(start?.width));
  const [height, setHeight] = useState(text(start?.height));
  const [unit, setUnit] = useState<Unit>(start?.unit ?? "in");
  const [material, setMaterial] = useState(start?.material ?? "");
  const [treatment, setTreatment] = useState<Treatment>(
    start?.treatment ?? "engraved",
  );
  const [colours, setColours] = useState<Colour[]>(
    start
      ? start.colours
      : initialFile?.colours.length
        ? initialFile.colours
        : [STARTER_COLOUR],
  );
  // The first row starts as "Natural": until it is edited, focusing it selects
  // the whole name, so typing replaces it instead of adding to it.
  const [starterName, setStarterName] = useState(
    !start && !initialFile?.colours.length,
  );
  const isStarter = (i: number, c: Colour) =>
    starterName && i === 0 && c.name === STARTER_COLOUR.name;
  const [wording, setWording] = useState<WordingRow[]>(
    (start?.wording ?? []).map((w) => ({
      label: w.label,
      example: w.example ?? "",
      maxChars: text(w.maxChars),
      optional: w.required === false,
    })),
  );
  const [places, setPlaces] = useState<string[]>(start?.useContexts ?? []);
  const [defaultColour, setDefaultColour] = useState(start?.defaultColour ?? 0);
  const [details, setDetails] = useState<Details>({
    ...emptyDetails(),
    depth: text(start?.depth),
    relief: text(start?.relief),
    hook: start?.hook ?? "",
    cta: start?.cta ?? "",
    description: start?.description ?? "",
  });
  const [price, setPrice] = useState(text(start?.price));
  // Up to two more views of the piece (the front one is the reference).
  const [views, setViews] = useState<{ label: ViewLabel; url: string }[]>(
    start?.views ?? [],
  );
  // Other designs of a vector product, and the own drawing's name.
  const [styles, setStyles] = useState<StyleRow[]>(
    (start?.styles ?? []).map((s) => ({
      ...(s.key ? { key: s.key } : {}),
      name: s.name,
      url: s.url,
      examples: s.examples ?? [],
    })),
  );
  const [styleName, setStyleName] = useState(start?.styleName ?? "");
  const [error, setError] = useState<string | null>(null);
  // After the first Save, each field shows its problem as it is fixed.
  const [attempted, setAttempted] = useState(false);
  const [degraded, setDegraded] = useState<Degraded | null>(null);
  const [ranOn, setRanOn] = useState<RanOn | null>(null);
  const [uploading, startUpload] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();

  const ratio = file?.kind === "vector" ? file.ratio : null;
  // "Review with AI": what the text model suggests and asks to check, under
  // each field, until used or dismissed. Nothing is saved until Save.
  const [review, setReview] = useState<
    (CleanReview & { model: string }) | null
  >(null);
  const [reviewDegraded, setReviewDegraded] = useState<Degraded | null>(null);
  const [reviewRanOn, setReviewRanOn] = useState<RanOn | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewing, startReview] = useTransition();
  const busy = uploading || drafting || saving || reviewing;
  // The colour whose material photo is being checked against its swatch, and
  // the photo's colour when the upload already read it.
  const [checking, setChecking] = useState<{
    row: number;
    photoColour: { name: string; hex: string } | null;
    seq: number;
  } | null>(null);
  const checks = useRef(0);
  const check = (
    row: number,
    photoColour: { name: string; hex: string } | null = null,
  ) => {
    checks.current += 1;
    setChecking({ row, photoColour, seq: checks.current });
  };
  const setRow = (row: number, change: Partial<Colour>) =>
    setColours((all) =>
      all.map((x, j) => (j === row ? { ...x, ...change } : x)),
    );

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

  // A colour's material photo: stored like the product photo, then checked
  // against the swatch. The photo never changes the swatch on its own.
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
      setRow(row, { swatchUrl: result.url });
      check(row, result.colours[0] ?? null);
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

  // Another style: an SVG of the same piece, stored like the product's.
  function uploadStyle(chosen: File) {
    setError(null);
    startUpload(async () => {
      const data = new FormData();
      data.set("file", chosen);
      const result = await uploadProductFileAction(data);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.kind !== "vector") {
        setError("A style is another design: upload its SVG.");
        return;
      }
      setStyles((all) => [
        ...all,
        {
          name: chosen.name.replace(/\.svg$/i, "").slice(0, 40),
          url: result.url,
          examples: [],
        },
      ]);
    });
  }

  function fill(model?: { provider: "google" | "openai"; model: string }) {
    if (file?.kind !== "photo") return;
    setError(null);
    startDraft(async () => {
      const result = await draftProductAction({ assetUrl: file.url, model });
      if (result.error) setError(result.error);
      setDegraded(result.degraded ?? null);
      setRanOn(result.ranOn ?? null);
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
      setPlaces(draft.useContext ? [draft.useContext] : []);
    });
  }

  // What Save sends: the form's state as the schema reads it.
  function formInput(): ProductForm {
    return {
      name,
      whatItIs,
      family,
      width: Number(width),
      height: Number(height),
      unit,
      material,
      treatment,
      colours:
        treatment === "reveal"
          ? colours.map((c) => ({ ...c, base: baseOf(c) }))
          : colours,
      wording: wording
        .filter((w) => w.label.trim() || w.example.trim())
        .map((w) => ({
          label: w.label,
          ...(w.example.trim() ? { example: w.example } : {}),
          maxChars: Number(w.maxChars) > 0 ? Number(w.maxChars) : null,
          required: !w.optional,
        })),
      useContexts: places.map((p) => p.trim()).filter(Boolean),
      defaultColour,
      ...(Number(details.depth) > 0 ? { depth: Number(details.depth) } : {}),
      ...(Number(details.relief) > 0 ? { relief: Number(details.relief) } : {}),
      ...(details.hook.trim() ? { hook: details.hook } : {}),
      ...(details.cta.trim() ? { cta: details.cta } : {}),
      ...(details.description.trim()
        ? { description: details.description }
        : {}),
      ...(Number(price) > 0 ? { price: Number(price) } : {}),
      views,
      ...(styleName.trim() ? { styleName } : {}),
      styles,
      ...(file
        ? {
            file:
              file.kind === "vector"
                ? {
                    kind: "vector",
                    url: file.url,
                    ...(file.drawnWidthPx > 0
                      ? { drawnWidthPx: file.drawnWidthPx }
                      : {}),
                  }
                : { kind: "photo", url: file.url },
          }
        : {}),
    };
  }

  // What the review reads: the form as it is held, rows in place, so a
  // suggestion names the row it means.
  function reviewInput(): ReviewForm {
    return {
      name,
      whatItIs,
      width: Number(width),
      height: Number(height),
      unit,
      material,
      treatment,
      colours: colours.map((c) => ({ name: c.name })),
      wording: wording.map((w) => ({
        label: w.label,
        example: w.example,
        maxChars: Number(w.maxChars) > 0 ? Number(w.maxChars) : null,
      })),
      useContexts: places,
      hook: details.hook,
      cta: details.cta,
      description: details.description,
    };
  }

  function runReview(model?: { provider: "google" | "openai"; model: string }) {
    setReviewError(null);
    startReview(async () => {
      const result = await reviewProductAction({
        form: reviewInput(),
        productId: editing?.productId,
        model,
      });
      if (result.error) setReviewError(result.error);
      setReviewDegraded(result.degraded ?? null);
      setReviewRanOn(result.ranOn ?? null);
      if (!result.review) return;
      setReview(result.review);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>("[data-review]")
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
    });
  }

  // Lay one suggestion into the form (cleanReview kept only what the field
  // takes), then drop it.
  function takeSuggestion(s: Suggestion) {
    const [head, index, part] = s.field.split(".");
    const i = Number(index);
    if (head === "name") setName(s.value);
    if (head === "whatItIs") setWhatItIs(s.value);
    if (head === "material") setMaterial(s.value);
    if (head === "treatment") {
      const finish = Treatment.safeParse(s.value);
      if (finish.success) setTreatment(finish.data);
    }
    if (head === "colours") {
      if (i === 0) setStarterName(false);
      setColours((all) =>
        all.map((c, j) => (j === i ? { ...c, name: s.value } : c)),
      );
    }
    if (
      head === "wording" &&
      (part === "label" || part === "example" || part === "maxChars")
    ) {
      setWording((rows) =>
        rows.map((r, j) => (j === i ? { ...r, [part]: s.value } : r)),
      );
    }
    if (head === "useContexts") {
      setPlaces((all) =>
        i < all.length
          ? all.map((p, j) => (j === i ? s.value : p))
          : [...all, s.value].slice(0, MAX_PLACES),
      );
    }
    if (head === "hook" || head === "cta" || head === "description") {
      setDetails((d) => ({ ...d, [head]: s.value }));
    }
    dismiss(s.field, "suggestion");
  }

  function dismiss(field: string, kind: "suggestion" | "check") {
    setReview((r) =>
      r
        ? kind === "suggestion"
          ? {
              ...r,
              suggestions: r.suggestions.filter((x) => x.field !== field),
            }
          : { ...r, checks: r.checks.filter((x) => x.field !== field) }
        : r,
    );
  }

  // A row added or removed moves the others: the review's notes on that list
  // no longer name the right row, so they go.
  function forget(list: "colours" | "wording" | "useContexts") {
    const kept = (field: string) => !field.startsWith(`${list}.`);
    setReview((r) =>
      r
        ? {
            ...r,
            suggestions: r.suggestions.filter((x) => kept(x.field)),
            checks: r.checks.filter((x) => kept(x.field)),
          }
        : r,
    );
  }

  function save() {
    setError(null);
    setAttempted(true);
    const first = formIssues(formInput(), limits)[0];
    if (first) {
      const at = document.querySelector<HTMLElement>(
        `[data-field="${first.path}"]`,
      );
      at?.scrollIntoView({ block: "center" });
      at?.focus({ preventScroll: true });
      return;
    }
    startSave(async () => {
      if (editing) {
        const saved = await updateProductAction({
          id: editing.productId,
          form: formInput(),
        });
        if ("error" in saved) setError(saved.error);
        else onSaved?.(saved);
        return;
      }
      const result = await createProductAction(formInput());
      if ("error" in result) setError(result.error);
      else onCreated?.(result.product, result.warning);
    });
  }

  // The fields as the review reads them now: a suggestion already typed in by
  // hand is not shown.
  const current = new Map(
    reviewFields(reviewInput(), limits).map((f) => [f.field, f.value.trim()]),
  );
  const open = review
    ? review.suggestions.filter((s) => current.get(s.field) !== s.value)
    : [];
  const note = (field: string) => {
    if (!review) return null;
    const suggestion = open.find((s) => s.field === field);
    const check = review.checks.find((c) => c.field === field);
    return (
      <ReviewNote
        suggestion={suggestion}
        check={check}
        onUse={takeSuggestion}
        onDismiss={(kind) => dismiss(field, kind)}
      />
    );
  };
  const preview = sizePreview(Number(width), Number(height), unit);
  const ratioNote = ratioCheck(ratio, Number(width), Number(height));
  const needed = stillNeeded(formInput(), limits);
  const problems = Object.fromEntries(
    (attempted ? formIssues(formInput(), limits) : []).map((i) => [
      i.path,
      i.message,
    ]),
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
      {checking && colours[checking.row]?.swatchUrl ? (
        <MaterialCheck
          key={checking.seq}
          colour={{
            name: colours[checking.row].name,
            hex: colours[checking.row].hex,
            swatchUrl: colours[checking.row].swatchUrl ?? "",
          }}
          photoColour={checking.photoColour}
          onClose={() => setChecking(null)}
          onPhoto={(url) => setRow(checking.row, { swatchUrl: url })}
          onHex={(hex) => setRow(checking.row, { hex: hex.toUpperCase() })}
        />
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            className="font-serif text-xl italic text-foreground"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            {editing ? "Edit product" : "New product"}
          </h3>
          <p className="mt-1 max-w-[560px] font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
            {editing
              ? "Change what is wrong and save: the projects that use it show what changed and offer the update."
              : "Tell Kiln what the piece is. A photo becomes the reference every scene starts from; a design file (SVG) is drawn to scale, so you can plan the listing before it is made."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          data-testid="product-close"
          disabled={busy}
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>

      {/* The file: optional. */}
      <div className="flex flex-wrap items-center gap-4">
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
                <FilePick
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  accept={PRODUCT_FILE_TYPES}
                  testId="product-file-replace"
                  label="Replace the photo or design file"
                  onFiles={([chosen]) => upload(chosen)}
                >
                  Replace
                </FilePick>
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="product-file-remove"
                  disabled={busy}
                  onClick={() => setFile(null)}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <FilePick
            unstyled
            disabled={busy}
            accept={PRODUCT_FILE_TYPES}
            testId="product-file"
            onFiles={([chosen]) => upload(chosen)}
            className="flex items-center gap-3 rounded-render border border-dashed border-border bg-surface-soft px-4 py-3 text-left transition-colors hover:border-primary"
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
          </FilePick>
        )}
        {file?.kind === "photo" ? (
          <Button
            variant="secondary"
            size="sm"
            data-testid="product-fill"
            disabled={busy}
            onClick={() => fill()}
          >
            {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Fill from the photo{draftPrice ? ` · ${draftPrice}` : ""}
          </Button>
        ) : null}
      </div>

      {ranOn && !degraded ? (
        <RanOnNotice ranOn={ranOn} testId="product-fill-ran-on" />
      ) : null}
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
          <Label text="Name" value={name} limit={limits.name} />
          <input
            data-field="name"
            data-testid="product-name"
            className={FIELD}
            value={name}
            placeholder="Engraved family cutting board"
            onChange={(e) => setName(e.target.value)}
          />
          {problem("name")}
          {note("name")}
        </label>
        <label className="flex flex-col gap-1.5">
          <Label text="What it is" value={whatItIs} limit={limits.whatItIs} />
          <input
            data-field="whatItIs"
            data-testid="product-what-it-is"
            className={FIELD}
            value={whatItIs}
            placeholder="cutting board, round coaster…"
            onChange={(e) => setWhatItIs(e.target.value)}
          />
          {problem("whatItIs")}
          {note("whatItIs")}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Size</span>
          <div className="flex items-center gap-2">
            <input
              aria-label="Width"
              data-field="width"
              data-testid="product-width"
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
              data-testid="product-height"
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
                  data-testid={`product-unit-${u}`}
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
          {note("size")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label text="Material" value={material} limit={limits.material} />
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
          {note("material")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            text="Family (optional)"
            value={family}
            limit={limits.family}
          />
          <MaterialCombobox
            label="Family"
            value={family}
            onChange={setFamily}
            options={families.filter((f) => f !== "General")}
            field={FIELD}
            placeholder="wall decor, kitchen, desk…"
          />
          {problem("family") ?? (
            <span className="font-sans text-[0.75rem] text-on-surface-mid">
              Kiln remembers your choices per family, like the hero's setting.
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
              aria-pressed={treatment === f.value}
              data-testid={`product-finish-${f.value}`}
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
        {note("treatment")}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Colours</span>
        <div className="flex flex-col gap-2">
          {colours.map((c, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
              key={i}
              className="flex flex-col gap-1"
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`Colour ${i + 1}`}
                  data-testid={`colour-${i + 1}`}
                  value={c.hex}
                  onChange={(e) =>
                    setColours((all) =>
                      all.map((x, j) =>
                        j === i
                          ? { ...x, hex: e.target.value.toUpperCase() }
                          : x,
                      ),
                    )
                  }
                  className="size-9 flex-shrink-0 cursor-pointer rounded-swatch border border-border bg-transparent"
                />
                <input
                  aria-label={`Colour ${i + 1} name`}
                  data-testid={`colour-${i + 1}-name`}
                  data-field={`colours.${i}.name`}
                  className={cn(FIELD, "max-w-[260px]")}
                  value={c.name}
                  onFocus={(e) => {
                    if (isStarter(i, c)) e.currentTarget.select();
                  }}
                  onMouseUp={(e) => {
                    if (isStarter(i, c)) e.preventDefault();
                  }}
                  onChange={(e) => {
                    if (i === 0) setStarterName(false);
                    setColours((all) =>
                      all.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    );
                  }}
                />
                {c.swatchUrl ? (
                  <span className="relative flex-shrink-0">
                    <button
                      type="button"
                      aria-label={`Check the material photo of ${c.name || `colour ${i + 1}`}`}
                      title="Check the photo against the swatch"
                      data-testid={`material-photo-${i + 1}-check`}
                      disabled={busy}
                      onClick={() => check(i)}
                      className="block rounded-swatch"
                    >
                      {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
                      <img
                        src={c.swatchUrl}
                        alt={`${c.name || `Colour ${i + 1}`} material`}
                        className="size-9 rounded-swatch border border-border object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove the material photo"
                      data-testid={`material-photo-${i + 1}-remove`}
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
                  <FilePick
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    accept="image/png,image/jpeg,image/webp"
                    testId={`material-photo-${i + 1}`}
                    label={`Material photo for ${c.name || `colour ${i + 1}`}`}
                    title="A close photo of the material in this colour, even light, no text: scenes copy its look"
                    onFiles={([chosen]) => uploadSample(i, chosen)}
                  >
                    <ImagePlus /> Material photo
                  </FilePick>
                )}
                {i === defaultColour ? (
                  <span className="font-mono text-[0.625rem] text-on-surface-dim">
                    default
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    data-testid={`colour-${i + 1}-default`}
                    onClick={() => setDefaultColour(i)}
                  >
                    Make default
                  </Button>
                )}
                {colours.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove colour ${i + 1}`}
                    data-testid={`colour-${i + 1}-remove`}
                    onClick={() => {
                      forget("colours");
                      setColours((all) => all.filter((_, j) => j !== i));
                      setDefaultColour((d) =>
                        i === d ? 0 : i < d ? d - 1 : d,
                      );
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              {treatment === "reveal" ? (
                <label className="flex items-center gap-2 pl-11 font-sans text-[0.75rem] text-on-surface-mid">
                  <input
                    type="color"
                    aria-label={`Colour ${i + 1} base`}
                    data-testid={`colour-${i + 1}-base`}
                    value={baseOf(c)}
                    onChange={(e) =>
                      setColours((all) =>
                        all.map((x, j) =>
                          j === i
                            ? { ...x, base: e.target.value.toUpperCase() }
                            : x,
                        ),
                      )
                    }
                    className="size-7 flex-shrink-0 cursor-pointer rounded-swatch border border-border bg-transparent"
                  />
                  Base that shows through the cuts
                </label>
              ) : null}
              <label className="flex items-center gap-2 pl-11 font-sans text-[0.75rem] text-on-surface-mid">
                <span className="flex-shrink-0">Supplier page</span>
                <input
                  type="url"
                  inputMode="url"
                  aria-label={`Colour ${i + 1} supplier page`}
                  data-testid={`colour-${i + 1}-supplier`}
                  data-field={`colours.${i}.supplierUrl`}
                  placeholder="https://… (optional)"
                  value={c.supplierUrl ?? ""}
                  onChange={(e) =>
                    setRow(i, {
                      supplierUrl: e.target.value.trim()
                        ? e.target.value
                        : undefined,
                    })
                  }
                  className={cn(FIELD, "h-7 max-w-[320px] text-[0.75rem]")}
                />
              </label>
              {problems[`colours.${i}.supplierUrl`] ? (
                <span className="pl-11 font-sans text-[0.75rem] text-prov-local">
                  {problems[`colours.${i}.supplierUrl`]}
                </span>
              ) : null}
              {note(`colours.${i}.name`)}
            </div>
          ))}
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
              data-testid="colour-add"
              onClick={() => {
                forget("colours");
                setColours((all) => [...all, { name: "", hex: "#808080" }]);
              }}
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
            onChange={(rows) => {
              if (rows.length !== wording.length) forget("wording");
              setWording(rows);
            }}
            problems={problems}
            notes={note}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Where it's used (optional)</span>
          <PlacesOfUse
            places={places}
            onChange={(next) => {
              if (next.length !== places.length) forget("useContexts");
              setPlaces(next);
            }}
            field={FIELD}
            notes={note}
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Price (optional)</span>
          <input
            data-testid="product-price"
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
                <MenuRoot>
                  <MenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Which view: ${viewName(v.label)}`}
                      data-testid={`product-view-${i + 1}-label`}
                      className="inline-flex items-center gap-1 rounded-[9px] px-1.5 py-1 font-sans text-[0.8rem] text-foreground hover:bg-secondary"
                    >
                      {viewName(v.label)}
                      <ChevronDown className="size-3 text-on-surface-mid" />
                    </button>
                  </MenuTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="start"
                      sideOffset={4}
                      className="z-50 min-w-[9rem] rounded-field bg-card p-1 shadow-card ring-1 ring-border"
                    >
                      {VIEW_LABELS.map((option) => (
                        <DropdownMenu.Item
                          key={option.value}
                          data-testid={`product-view-${i + 1}-label-${option.value}`}
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
                </MenuRoot>
                <button
                  type="button"
                  aria-label={`Remove the ${viewName(v.label)} view`}
                  data-testid={`product-view-${i + 1}-remove`}
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
              <FilePick
                variant="ghost"
                size="xs"
                disabled={busy}
                accept={PRODUCT_FILE_TYPES}
                testId="product-view-add"
                onFiles={([chosen]) => uploadView(chosen)}
              >
                <ImagePlus /> Add a view
              </FilePick>
            ) : null}
          </div>
          <span className="font-sans text-[0.75rem] text-on-surface-mid">
            {treatment === "raised" && !views.some((v) => v.label === "side")
              ? "A side view shows how far the marks stand out; scenes read it beside the front."
              : "What the front cannot show — the side, the top of a base. A photo or an SVG drawing."}
          </span>
        </div>
      </div>

      {file?.kind === "vector" || styles.length > 0 ? (
        <ProductStyles
          styles={styles}
          onStyles={setStyles}
          styleName={styleName}
          onStyleName={setStyleName}
          lines={wording
            .filter((w) => w.label.trim() || w.example.trim())
            .map((w) => ({ label: w.label, example: w.example }))}
          busy={busy}
          onAdd={uploadStyle}
          problems={problems}
          field={FIELD}
          label={LABEL}
        />
      ) : null}

      <MoreDetails
        details={details}
        onChange={setDetails}
        unit={unit}
        treatment={treatment}
        field={FIELD}
        label={LABEL}
        notes={note}
        reveal={
          open.some((x) => DETAIL_FIELDS.has(x.field)) ||
          (review?.checks ?? []).some((x) => DETAIL_FIELDS.has(x.field))
        }
      />

      {reviewRanOn && !reviewDegraded ? (
        <RanOnNotice ranOn={reviewRanOn} testId="product-review-ran-on" />
      ) : null}
      {reviewDegraded ? (
        <DegradedNotice
          degraded={reviewDegraded}
          fellBackTo="nothing: the form is as you left it"
          verb="Review it"
          pending={reviewing}
          onAlternative={(model) => runReview(model)}
        />
      ) : null}
      {review ? (
        <output className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-field bg-secondary px-4 py-3">
          <Sparkles className="size-3.5 text-primary" />
          <span className="font-sans text-[0.8125rem] text-foreground">
            {reviewSummary(review.model, open.length, review.checks.length)}
          </span>
          {open.length > 1 ? (
            <Button
              size="xs"
              data-testid="product-review-use-all"
              onClick={() => {
                for (const s of open) takeSuggestion(s);
              }}
            >
              Use all
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            data-testid="product-review-dismiss"
            onClick={() => setReview(null)}
          >
            {open.length + review.checks.length === 0 ? "Close" : "Dismiss all"}
          </Button>
        </output>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border-soft pt-4">
        <Button
          data-testid="product-save"
          disabled={busy}
          onClick={save}
          className="h-10 rounded-field px-5 font-semibold shadow-button"
        >
          {saving ? <Loader2 className="animate-spin" /> : null}
          {editing ? "Save changes" : "Save product"}
        </Button>
        <Button
          variant="ghost"
          data-testid="product-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="secondary"
          data-testid="product-review"
          disabled={busy}
          onClick={() => runReview()}
        >
          {reviewing ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Review with AI{reviewPrice ? ` · ${reviewPrice}` : ""}
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
        {reviewError ? (
          <span className="w-full font-mono text-[0.7rem] text-prov-local">
            {reviewError}
          </span>
        ) : null}
      </div>
    </div>
  );
}

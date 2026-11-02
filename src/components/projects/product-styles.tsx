"use client";

import { ImagePlus, X } from "lucide-react";
import { FilePick } from "@/components/ui/file-pick";
import { isRenderableUrl } from "@/lib/asset-url";
import { cn } from "@/lib/utils";

export interface StyleRow {
  // The stored style this row edits (absent for a new one).
  key?: string;
  name: string;
  url: string;
  // One per wording line; empty shows the product's example.
  examples: string[];
}

const SVG_TYPES = "image/svg+xml,.svg";

// A vector product's other designs (ROADMAP P2-9): each a drawing of the same
// piece with the wording it shows, chosen per project and per frame like a
// colour. Kiln redraws every style in every colour, so a style is uploaded
// once, in any of the product's colours.
export function ProductStyles({
  styles,
  onStyles,
  styleName,
  onStyleName,
  lines,
  busy,
  onAdd,
  problems,
  field,
  label,
}: {
  styles: StyleRow[];
  onStyles: (rows: StyleRow[]) => void;
  styleName: string;
  onStyleName: (name: string) => void;
  // The product's wording lines: a style's example per line.
  lines: { label: string; example: string }[];
  busy: boolean;
  // The editor uploads the SVG and adds its row.
  onAdd: (file: File) => void;
  problems: Record<string, string>;
  field: string;
  label: string;
}) {
  const set = (row: number, change: Partial<StyleRow>) =>
    onStyles(styles.map((s, i) => (i === row ? { ...s, ...change } : s)));
  return (
    <div
      className="flex flex-col gap-2 sm:col-span-2"
      data-testid="product-styles"
    >
      <span className={label}>Styles (optional)</span>
      {styles.length > 0 ? (
        <label className="flex items-center gap-2 font-sans text-[0.75rem] text-on-surface-mid">
          <span className="flex-shrink-0">This design is called</span>
          <input
            data-testid="product-style-name"
            data-field="styleName"
            aria-label="Name of the product's own design"
            maxLength={40}
            placeholder="Original"
            value={styleName}
            onChange={(e) => onStyleName(e.target.value)}
            className={cn(field, "h-7 max-w-[240px] text-[0.75rem]")}
          />
        </label>
      ) : null}
      {styles.map((s, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
          key={i}
          data-testid={`product-style-${i + 1}`}
          className="flex flex-col gap-1.5 rounded-field bg-surface-soft p-2"
        >
          <div className="flex items-center gap-2">
            <span className="size-9 flex-shrink-0 overflow-hidden rounded-swatch border border-border bg-card">
              {isRenderableUrl(s.url) ? (
                // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
                <img
                  src={s.url}
                  alt={`${s.name || `Style ${i + 1}`} design`}
                  className="h-full w-full object-contain"
                />
              ) : null}
            </span>
            <input
              aria-label={`Style ${i + 1} name`}
              data-testid={`product-style-${i + 1}-name`}
              data-field={`styles.${i}.name`}
              maxLength={40}
              placeholder="Name this style"
              value={s.name}
              onChange={(e) => set(i, { name: e.target.value })}
              className={cn(field, "h-8 max-w-[260px]")}
            />
            <button
              type="button"
              aria-label={`Remove style ${s.name || i + 1}`}
              data-testid={`product-style-${i + 1}-remove`}
              onClick={() => onStyles(styles.filter((_, j) => j !== i))}
              className="p-1 text-on-surface-mid hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
          {lines.map((line, j) => (
            <label
              // biome-ignore lint/suspicious/noArrayIndexKey: one per wording line
              key={j}
              className="flex items-center gap-2 pl-11 font-sans text-[0.75rem] text-on-surface-mid"
            >
              <span className="w-28 flex-shrink-0 truncate">
                {line.label || `Line ${j + 1}`}
              </span>
              <input
                aria-label={`Style ${i + 1}, ${line.label || `line ${j + 1}`}`}
                data-testid={`product-style-${i + 1}-example-${j + 1}`}
                data-field={`styles.${i}.examples.${j}`}
                placeholder={line.example || "As the product"}
                value={s.examples[j] ?? ""}
                onChange={(e) =>
                  set(i, {
                    examples: lines.map((_, k) =>
                      k === j ? e.target.value : (s.examples[k] ?? ""),
                    ),
                  })
                }
                className={cn(field, "h-7 max-w-[260px] text-[0.75rem]")}
              />
            </label>
          ))}
          {[
            `styles.${i}.name`,
            ...lines.map((_, j) => `styles.${i}.examples.${j}`),
          ].map((path) =>
            problems[path] ? (
              <span
                key={path}
                className="pl-11 font-sans text-[0.75rem] text-prov-local"
              >
                {problems[path]}
              </span>
            ) : null,
          )}
        </div>
      ))}
      {styles.length < 8 ? (
        <FilePick
          variant="ghost"
          size="xs"
          className="self-start"
          disabled={busy}
          accept={SVG_TYPES}
          testId="product-style-add"
          onFiles={([chosen]) => onAdd(chosen)}
        >
          <ImagePlus /> Add a style
        </FilePick>
      ) : null}
      {problems.styles ? (
        <span className="font-sans text-[0.75rem] text-prov-local">
          {problems.styles}
        </span>
      ) : null}
      <span className="font-sans text-[0.75rem] text-on-surface-mid">
        Another design of this piece, like other wording: its SVG in any of the
        product's colours. Kiln redraws each style in each colour, and a project
        or a frame picks one.
      </span>
    </div>
  );
}

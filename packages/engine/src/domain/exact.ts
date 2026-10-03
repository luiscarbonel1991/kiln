import {
  type ColourOption,
  dimensionsLabel,
  type Product,
  type Treatment,
} from "@/domain/product";
import type { ExactKind } from "@/domain/shot-list";

// View models for exact slots: everything a frame shows, computed from the
// product spec alone — no image model, no cost, the same output every time. The
// app draws them (SVG); a delivery step can rasterize the same models later.

const TREATMENT_LABEL: Record<Treatment, string> = {
  raised: "Raised",
  inlaid: "Inlaid",
  engraved: "Engraved",
  printed: "Printed",
  cut: "Cut-out",
};

// "{product.name}"-style tokens. Unknown tokens stay as written, so a typo is
// visible on the frame instead of silently vanishing.
export function renderTextTemplate(template: string, product: Product): string {
  const values: Record<string, string> = {
    "product.name": product.name,
    "product.family": product.family,
    "product.dimensions": dimensionsLabel(product.dimensions),
    "product.material": product.material,
    "product.shape": product.shape,
    "colours.count": String(product.colours.length),
  };
  return template.replace(/\{([a-z.]+)\}/g, (token, key: string) =>
    key in values ? values[key] : token,
  );
}

const DEFAULT_TITLE: Record<ExactKind, string> = {
  "colour-grid": "Available in {colours.count} colours",
  "size-spec": "{product.dimensions}",
  personalize: "Make it yours",
  "text-card": "{product.name}",
};

export type ExactView =
  | { kind: "colour-grid"; title: string; swatches: ColourOption[] }
  | {
      kind: "size-spec";
      title: string;
      width: number;
      height: number;
      unit: string;
      depth?: number;
      facts: { label: string; value: string }[];
    }
  | {
      kind: "personalize";
      title: string;
      lines: {
        label: string;
        maxChars: number | null;
        required: boolean;
        example?: string;
      }[];
    }
  | { kind: "text-card"; title: string; subtitle: string };

export function exactView(
  kind: ExactKind,
  product: Product,
  textTemplate?: string,
): ExactView {
  const title = renderTextTemplate(
    textTemplate ?? DEFAULT_TITLE[kind],
    product,
  );
  switch (kind) {
    case "colour-grid":
      return { kind, title, swatches: product.colours };
    case "size-spec": {
      const d = product.dimensions;
      return {
        kind,
        title,
        width: d.w,
        height: d.h,
        unit: d.unit,
        ...(d.d ? { depth: d.d } : {}),
        facts: [
          { label: "Shape", value: product.shape },
          { label: "Material", value: product.material },
          { label: "Finish", value: TREATMENT_LABEL[product.treatment] },
          { label: "Lettering", value: product.typography.family },
        ],
      };
    }
    case "personalize":
      return {
        kind,
        title,
        lines: product.wording.map((w) => ({
          label: w.label,
          maxChars: w.maxChars,
          required: w.required,
          ...(w.example ? { example: w.example } : {}),
        })),
      };
    case "text-card":
      return { kind, title, subtitle: product.family };
  }
}

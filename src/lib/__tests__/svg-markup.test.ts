import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { exactView } from "@/domain/exact";
import type { ExactKind } from "@/domain/shot-list";
import { parseProductPackage } from "@/lib/product-package";
import { escapeMarkup, toSvgMarkup } from "@/lib/svg-markup";
import pkg from "../__fixtures__/product-package.json";

const parsed = parseProductPackage(pkg);
if (!parsed.ok) throw new Error("fixture package does not parse");
const [board, coaster, planter] = parsed.products;
const brand = parsed.brand ?? null;

const KINDS: ExactKind[] = [
  "colour-grid",
  "size-spec",
  "scale",
  "personalize",
  "text-card",
];

const frames = [board, coaster, planter].flatMap((product) =>
  KINDS.filter((k) => k !== "personalize" || product.wording.length > 0).map(
    (kind) => ({
      name: `${product.sku} ${kind}`,
      element: createElement(ExactSlotArt, {
        view: exactView(
          kind,
          product,
          kind === "text-card" ? "{product.cta}" : undefined,
          brand,
        ),
        aspect: kind === "text-card" ? "4:5" : "1:1",
        plate:
          product.source.kind === "vector"
            ? {
                href: product.source.svgUrl,
                box: { x: 0.025, y: 0.025, w: 0.95, h: 0.95 },
              }
            : null,
      }),
    }),
  ),
);

describe("toSvgMarkup", () => {
  it.each(frames)("prints $name exactly as React does", ({ element }) => {
    expect(toSvgMarkup(element)).toBe(renderToStaticMarkup(element));
  });

  it("swaps the app's font variables for real family names", () => {
    const markup = toSvgMarkup(frames[0].element, {
      fonts: { "var(--font-fraunces)": "Fraunces" },
    });
    expect(markup).toContain("font-family:Fraunces");
    expect(markup).not.toContain("var(--font-fraunces)");
  });

  it("escapes text and attribute values", () => {
    expect(escapeMarkup(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#x27;s&lt;/a&gt;",
    );
  });
});

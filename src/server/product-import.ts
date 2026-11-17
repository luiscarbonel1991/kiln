import type { BrandKit } from "@/domain/brand";
import type { OutlineBox, Product } from "@/domain/product";
import {
  parseProductPackage,
  productLabel,
  type RejectedProduct,
} from "@/domain/product-package";
import { sanitizeSvg } from "@/lib/svg-sanitize";
import {
  assertAllowedAssetUrl,
  fetchAsset,
  storeAsset,
} from "@/providers/asset-bytes";
import { measureOutline, rasterize } from "@/providers/plates/svg";
import type { MakerRef } from "@/server/maker-repository";
import {
  type ImportedProduct,
  importCatalog,
} from "@/server/product-repository";

// Importing a product package, the same for every way in: the New project
// page (a file or pasted JSON, through its Server Action) and the HTTP API
// (POST /api/import, behind a personal access token). The package parse is
// the trust boundary; assets are checked against the allowlist, inline images
// are stored, vector outlines measured, then the catalog is saved.

// The address a product's source asset is fetched from, if it has one.
function sourceUrl(product: Product): string | null {
  if (product.source.kind === "vector") return product.source.svgUrl;
  if (product.source.kind === "photo") return product.source.assetUrl;
  return null;
}

// A product whose assets live where Kiln will not fetch is refused at import,
// not later when a plate or a scene needs them: the reason, or null. Its
// source, each colour's material sample and each view.
export function blockedAsset(product: Product): string | null {
  const source = sourceUrl(product);
  const urls = [
    ...(source ? [{ where: null, url: source }] : []),
    ...product.colours.flatMap((c) =>
      c.swatchUrl
        ? [{ where: `colours › ${c.key} › swatchUrl`, url: c.swatchUrl }]
        : [],
    ),
    ...(product.views ?? []).map((v) => ({
      where: `views › ${v.label} › url`,
      url: v.url,
    })),
    ...(product.styles ?? []).map((s) => ({
      where: `styles › ${s.key} › svgUrl`,
      url: s.svgUrl,
    })),
  ];
  for (const { where, url } of urls) {
    try {
      assertAllowedAssetUrl(url);
    } catch (error) {
      const reason = (error as Error).message;
      return where ? `${where}: ${reason}` : reason;
    }
  }
  return null;
}

// Where a drawing's outline sits in its frame, measured (never taken from a
// package), or why it is left without one.
async function outlineOf(
  url: string,
  product: Product,
  scalePxPerUnit?: number,
): Promise<{ box: OutlineBox } | { problem: string }> {
  try {
    const { bytes } = await fetchAsset(url);
    const measured = measureOutline(
      bytes.toString("utf8"),
      product.dimensions,
      scalePxPerUnit,
    );
    return "box" in measured ? measured : { problem: measured.mismatch };
  } catch (error) {
    return {
      problem: `its SVG could not be measured (${(error as Error).message})`,
    };
  }
}

// A vector product's outline, and each style's, measured from its SVG: exact
// frames draw it to scale. A drawing that does not match the declared
// dimensions is imported without one (its frames draw the spec's outline)
// and reported.
export async function withOutline(
  product: Product,
): Promise<{ product: Product; warning?: string }> {
  if (product.source.kind !== "vector") return { product };
  const { outlineBox: _ignored, ...source } = product.source;
  const warnings: string[] = [];
  const own = await outlineOf(source.svgUrl, product, source.scalePxPerUnit);
  if ("problem" in own) warnings.push(own.problem);
  const styles = product.styles
    ? await Promise.all(
        product.styles.map(async ({ outlineBox: _old, ...style }) => {
          const measured = await outlineOf(style.svgUrl, product);
          if ("box" in measured) return { ...style, outlineBox: measured.box };
          warnings.push(`the ${style.name} style: ${measured.problem}`);
          return style;
        }),
      )
    : undefined;
  return {
    product: {
      ...product,
      source: "box" in own ? { ...source, outlineBox: own.box } : source,
      ...(styles ? { styles } : {}),
    },
    ...(warnings.length > 0
      ? {
          warning: `${warnings.join("; ")}; its scale frames draw the outline from the spec.`,
        }
      : {}),
  };
}

const RASTER = new Set(["image/png", "image/jpeg", "image/webp"]);

// An image given inline (a data: URL) — the product's photo, a colour's
// material sample — is moved to Kiln's storage: a scene's reference must be a
// stored image, as the New project page promises. Named by its bytes, so
// re-importing the same image keeps the product unchanged. A sample goes to
// the image model, so it must be a photo, never an SVG.
async function storedInline(url: string, what: string): Promise<string> {
  if (!url.startsWith("data:")) return url;
  const image = await fetchAsset(url);
  if (!RASTER.has(image.mime)) {
    throw new Error(`${what} must be a PNG, JPEG or WebP image`);
  }
  return storeAsset(image.bytes, image.mime, "products", { byContent: true });
}

// The ground a view drawing is rendered on: the reference plate's.
const VIEW_GROUND = "#F0EEE9";

// A view goes to the image model beside the reference, so it must be a
// raster in Kiln's storage: an inline image is stored by its bytes, an SVG
// drawing (inline or fetched) is cleaned and rendered to PNG on the plate's
// ground. A raster already at an allowed address stays where it is.
async function storedView(url: string, label: string): Promise<string> {
  const image = await fetchAsset(url);
  if (image.mime === "image/svg+xml") {
    const clean = sanitizeSvg(image.bytes.toString("utf8"));
    if (!clean)
      throw new Error(`the ${label} view is not a drawing Kiln can read`);
    const png = rasterize(clean, 1024, VIEW_GROUND);
    return storeAsset(png, "image/png", "products", { byContent: true });
  }
  if (!RASTER.has(image.mime)) {
    throw new Error(`the ${label} view must be a PNG, JPEG, WebP or SVG image`);
  }
  return url.startsWith("data:")
    ? storeAsset(image.bytes, image.mime, "products", { byContent: true })
    : url;
}

export async function withStoredImages(product: Product): Promise<Product> {
  const source =
    product.source.kind === "photo"
      ? {
          kind: "photo" as const,
          assetUrl: await storedInline(product.source.assetUrl, "its photo"),
        }
      : product.source;
  const colours = await Promise.all(
    product.colours.map(async (c) =>
      c.swatchUrl
        ? {
            ...c,
            swatchUrl: await storedInline(
              c.swatchUrl,
              `the ${c.name} material sample`,
            ),
          }
        : c,
    ),
  );
  const views = product.views
    ? await Promise.all(
        product.views.map(async (v) => ({
          ...v,
          url: await storedView(v.url, v.label),
        })),
      )
    : undefined;
  return { ...product, source, colours, ...(views ? { views } : {}) };
}

// Scenes show a product in its default colour: one out of stock would sell a
// look the maker cannot ship.
function outOfStockDefault(product: Product): string | null {
  const colour = product.colours.find((c) => c.key === product.defaultColour);
  return colour && !colour.inStock
    ? `${productLabel(product)}: its default colour, ${colour.name}, is out of stock, and scenes show the default colour. Pick one in stock as defaultColour.`
    : null;
}

export interface ImportResult {
  imported: ImportedProduct[];
  // Products set aside, each with why; the others imported.
  rejected: RejectedProduct[];
  brand?: BrandKit;
  // Why the maker block was not saved.
  brandErrors: string[];
  warnings: string[];
}

// Import a product package for the current maker, product by product: the
// valid ones are saved (re-importing a sku updates that product in place —
// its id, and every project using it, stay — and says what changed), the
// others come back with their reasons; a `maker` block replaces the maker's
// brand kit. `error` when nothing in it reads as a package, or the save failed
// (then nothing was saved).
export async function importPackage(
  maker: MakerRef,
  input: unknown,
): Promise<ImportResult | { error: string }> {
  const parsed = parseProductPackage(input);
  if (!parsed.ok) return { error: parsed.errors.join(" ") };
  const rejected = [...parsed.rejected];
  const ready: Product[] = [];
  for (const product of parsed.products) {
    const blocked = blockedAsset(product);
    if (blocked) {
      rejected.push({ label: productLabel(product), errors: [blocked] });
      continue;
    }
    try {
      ready.push(await withStoredImages(product));
    } catch (error) {
      rejected.push({
        label: productLabel(product),
        errors: [`an image could not be stored: ${(error as Error).message}`],
      });
    }
  }
  const measured = await Promise.all(ready.map(withOutline));
  const warnings = [
    ...measured.flatMap((m) =>
      m.warning ? [`${productLabel(m.product)}: ${m.warning}`] : [],
    ),
    ...ready.flatMap((p) => {
      const warning = outOfStockDefault(p);
      return warning ? [warning] : [];
    }),
    ...parsed.notes,
  ];
  let imported: ImportedProduct[] = [];
  if (measured.length > 0 || parsed.brand) {
    try {
      imported = await importCatalog(
        maker,
        measured.map((m) => m.product),
        parsed.brand,
      );
    } catch (error) {
      return { error: `Nothing was saved: ${(error as Error).message}` };
    }
  }
  const keptNotes = imported.flatMap(({ product, kept }) =>
    kept
      ? [
          `${productLabel(product)}: kept the material ${kept.length === 1 ? "photo" : "photos"} of ${kept.join(", ")} (the package gives none).`,
        ]
      : [],
  );
  return {
    imported,
    rejected,
    ...(parsed.brand ? { brand: parsed.brand } : {}),
    brandErrors: parsed.brandErrors,
    warnings: [...warnings, ...keptNotes],
  };
}

// An import as the HTTP API answers it: each product by its Kiln id, sku and
// name with its colours' keys (what a material photo is posted to), never
// the whole product.
export interface ImportSummary {
  imported: {
    id: string;
    sku: string;
    name: string;
    status: ImportedProduct["status"];
    changed: string[];
    colours: { key: string; name: string; swatchUrl: string | null }[];
  }[];
  rejected: RejectedProduct[];
  // Whether the package's maker block was saved as the brand kit.
  brandSaved: boolean;
  brandErrors: string[];
  warnings: string[];
}

export function importSummary(result: ImportResult): ImportSummary {
  return {
    imported: result.imported.map(({ product, status, changed }) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      status,
      changed,
      colours: product.colours.map((c) => ({
        key: c.key,
        name: c.name,
        swatchUrl: c.swatchUrl ?? null,
      })),
    })),
    rejected: result.rejected,
    brandSaved: Boolean(result.brand),
    brandErrors: result.brandErrors,
    warnings: result.warnings,
  };
}

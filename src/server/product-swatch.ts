import { rasterType } from "@/domain/image-type";
import { colourName } from "@/lib/product-form";
import { storeAsset } from "@/providers/asset-bytes";
import { photoColours } from "@/server/product-files";
import {
  findProduct,
  productProjects,
  setSwatchUrl,
} from "@/server/product-repository";
import { productHash } from "@/server/product-version";

// A colour's material sample (`swatchUrl`) set or removed without the product
// form: the HTTP API's POST / DELETE /api/products/:id/colours/:key/swatch.
// The photo is stored by its bytes, so sending the same photo again changes
// nothing. The colour's swatch hex is the maker's and stays: the photo's own
// colour comes back as a suggestion (DOGFOOD #40, #50).

export type SwatchOutcome =
  | {
      ok: true;
      product: { id: string; sku: string; name: string };
      colour: {
        key: string;
        name: string;
        face: string;
        swatchUrl: string | null;
      };
      status: "updated" | "unchanged";
      changed: string[];
      // Projects that follow an earlier version of the product: each offers
      // "Update the project" on its board.
      behind: { projectId: string; name: string }[];
      // The photo's main colour, never applied to the swatch.
      photoColour?: { name: string; hex: string };
    }
  | { ok: false; status: 404 | 409 | 415; error: string };

export async function setColourSwatch(
  ref: string,
  key: string,
  photo: Uint8Array | null,
): Promise<SwatchOutcome> {
  const product = await findProduct(ref);
  if (!product) {
    return {
      ok: false,
      status: 404,
      error: `No product "${ref}": use its id or its sku.`,
    };
  }
  if (product.source.kind === "catalog") {
    return {
      ok: false,
      status: 409,
      error:
        "This product comes from your catalog: change it there and import it again.",
    };
  }
  const colour = product.colours.find((c) => c.key === key);
  if (!colour) {
    return {
      ok: false,
      status: 404,
      error: `"${product.sku}" has no colour "${key}"; its colours are ${product.colours.map((c) => c.key).join(", ")}.`,
    };
  }

  let swatchUrl: string | null = null;
  let photoColour: { name: string; hex: string } | undefined;
  if (photo) {
    const mime = rasterType(photo);
    if (!mime) {
      return {
        ok: false,
        status: 415,
        error:
          "A material photo must be a PNG, JPEG or WebP image: a close photo of the material, even light, no text.",
      };
    }
    swatchUrl = await storeAsset(photo, mime, "products", { byContent: true });
    const [hex] = await photoColours(photo, 1);
    if (hex) photoColour = { name: colourName(hex), hex };
  }

  // Under the product's row lock: another colour's photo sent at the same
  // moment is kept.
  const saved = await setSwatchUrl(product.id, key, swatchUrl);
  if (!saved) {
    return {
      ok: false,
      status: 404,
      error: `"${product.sku}" or its colour "${key}" was removed meanwhile.`,
    };
  }
  const now = productHash(saved.product);
  const behind = (await productProjects(product.id))
    .filter((use) => use.hash !== now)
    .map(({ projectId, name }) => ({ projectId, name }));
  return {
    ok: true,
    product: {
      id: saved.product.id,
      sku: saved.product.sku,
      name: saved.product.name,
    },
    colour: {
      key: colour.key,
      name: colour.name,
      face: colour.face,
      swatchUrl,
    },
    status: saved.status === "unchanged" ? "unchanged" : "updated",
    changed: saved.changed,
    behind,
    ...(photoColour ? { photoColour } : {}),
  };
}

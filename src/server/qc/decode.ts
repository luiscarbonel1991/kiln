import { Resvg } from "@resvg/resvg-js";
import type { OcrBox } from "@/domain/qc";
import type { RgbaImage } from "@/domain/qc-pixels";

// Images for the take check, decoded in-process by resvg (already the plate
// renderer): an <image> drawn at its own size gives its pixels. PNG and JPEG,
// what the image models return; anything else is not opened.
const DECODABLE = new Set(["image/png", "image/jpeg", "image/jpg"]);

export function imageSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      const length = view.getUint16(at + 2);
      // A start-of-frame segment (not DHT C4, JPG C8 or DAC CC) holds the size.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: view.getUint16(at + 5),
          width: view.getUint16(at + 7),
        };
      }
      at += 2 + length;
    }
  }
  return null;
}

const dataUrl = (bytes: Uint8Array, mime: string) =>
  `data:${mime === "image/jpg" ? "image/jpeg" : mime};base64,${Buffer.from(bytes).toString("base64")}`;

// The image's pixels with its longer side at most `maxSide`, or null for a
// format Kiln does not open.
export function decodeImage(
  bytes: Uint8Array,
  mime: string,
  maxSide = 2048,
): RgbaImage | null {
  if (!DECODABLE.has(mime)) return null;
  const size = imageSize(bytes);
  if (!size || size.width === 0 || size.height === 0) return null;
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><image width="${size.width}" height="${size.height}" href="${dataUrl(bytes, mime)}"/></svg>`;
  const out = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: Math.max(1, Math.round(size.width * scale)),
    },
  }).render();
  return { width: out.width, height: out.height, pixels: out.pixels };
}

// Pieces cut out of an image and laid side by side on its ground, in the
// order given, as a PNG: OCR reads a stack of single characters once they
// stand in a row. Boxes are fractions of the image, each padded by a quarter
// of its height.
export function relayRow(
  bytes: Uint8Array,
  mime: string,
  boxes: OcrBox[],
  ground: string,
): Uint8Array | null {
  const size = imageSize(bytes);
  if (!size || boxes.length === 0) return null;
  const crops = boxes.map((b) => {
    const pad = (b.h * size.height) / 4;
    const x = Math.max(0, b.x * size.width - pad);
    const y = Math.max(0, b.y * size.height - pad);
    return {
      x,
      y,
      w: Math.min(size.width - x, b.w * size.width + 2 * pad),
      h: Math.min(size.height - y, b.h * size.height + 2 * pad),
    };
  });
  const height = Math.ceil(Math.max(...crops.map((c) => c.h)));
  let left = 0;
  const placed = crops.map((c, i) => {
    const top = (height - c.h) / 2;
    const part = `<clipPath id="c${i}"><rect x="${left}" y="${top}" width="${c.w}" height="${c.h}"/></clipPath><g clip-path="url(#c${i})"><use href="#src" x="${left - c.x}" y="${top - c.y}"/></g>`;
    left += c.w;
    return part;
  });
  const width = Math.ceil(left);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><defs><image id="src" width="${size.width}" height="${size.height}" href="${dataUrl(bytes, mime)}"/></defs><rect width="${width}" height="${height}" fill="${ground}"/>${placed.join("")}</svg>`;
  return new Uint8Array(new Resvg(svg).render().asPng());
}

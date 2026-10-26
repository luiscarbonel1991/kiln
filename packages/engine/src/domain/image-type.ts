// What raster image a file is, read from its first bytes rather than its name
// or the type a caller declared: a material photo goes to the image model, so
// only PNG, JPEG and WebP pass. Null for anything else (SVG, HEIC, text).

export type RasterType = "image/png" | "image/jpeg" | "image/webp";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

export function rasterType(bytes: Uint8Array): RasterType | null {
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return bytes[2] === 0xff ? "image/jpeg" : null;
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

// A JPEG's size, from its first start-of-frame marker (SOF0–SOF15, not the
// table markers that share the range).
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) return { height: be16(b, i + 5), width: be16(b, i + 7) };
    i += 2 + be16(b, i + 2);
  }
  return null;
}

// A WebP's size, from its first chunk: lossy (VP8), lossless (VP8L) or
// extended (VP8X, the canvas).
function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 25) return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === "VP8L") {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (b.length < 30) return null;
  if (chunk === "VP8 ") {
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (chunk === "VP8X") {
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return null;
}

// A raster's pixel size, read from its header (no decoding): PNG, JPEG or
// WebP. Null for anything else, or a header too short to read.
export function imageSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const type = rasterType(bytes);
  const size =
    type === "image/png"
      ? bytes.length >= 24
        ? {
            width:
              ((bytes[16] << 24) | (bytes[17] << 16) | be16(bytes, 18)) >>> 0,
            height:
              ((bytes[20] << 24) | (bytes[21] << 16) | be16(bytes, 22)) >>> 0,
          }
        : null
      : type === "image/jpeg"
        ? jpegSize(bytes)
        : type === "image/webp"
          ? webpSize(bytes)
          : null;
  return size && size.width > 0 && size.height > 0 ? size : null;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// "4:3" for 2000 x 1500: a size as the aspect frames are drawn at.
export function sizeAspect(size: { width: number; height: number }): string {
  const g = gcd(size.width, size.height);
  return `${size.width / g}:${size.height / g}`;
}

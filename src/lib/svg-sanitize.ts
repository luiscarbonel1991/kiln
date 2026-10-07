// An uploaded design SVG keeps its drawing and loses anything that could run
// or reach out: scripts, foreign HTML, event handlers, javascript: links,
// external references (hrefs, url(), @import), DOCTYPE/entities and
// stylesheet instructions. Kiln renders it with resvg and shows it as an
// image, where none of that runs anyway; this is for the file itself, served
// from storage. Null when it is not an SVG document.

const MAX_SVG_CHARS = 5_000_000;

export function sanitizeSvg(text: string): string | null {
  if (text.length > MAX_SVG_CHARS) return null;
  let svg = text
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, "")
    .replace(/<!ENTITY[\s\S]*?>/gi, "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/@import[^;]*;?/gi, "");
  // Links: only in-document (#id) and inline images stay.
  svg = svg.replace(
    /\s+(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (whole, _attr, _quoted, dq, sq) => {
      const value = String(dq ?? sq ?? "").trim();
      return value.startsWith("#") ||
        /^data:image\/(png|jpe?g|webp|gif);/i.test(value)
        ? whole
        : "";
    },
  );
  svg = svg.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, "none");
  if (/javascript:/i.test(svg)) return null;
  return /<svg[\s>]/i.test(svg) ? svg.trim() : null;
}

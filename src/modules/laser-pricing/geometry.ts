import { svgPathProperties } from "svg-path-properties";
import type { SvgGeometry } from "@/modules/laser-pricing/types";

// Parse an SVG string into scale-independent geometry: per-color path length (for
// cut/score), a bounding box, and an engrave fill estimate. Pure and deterministic
// so it unit-tests against a known fixture. The server action fetches the bytes;
// this only touches the string.

// The root <svg ...> opening tag only — so width/height/viewBox can never be picked
// up from a child's stroke-width, a <rect width>, etc.
function rootTag(svg: string): string {
  return svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
}

function parseViewport(svg: string): { wPx: number; hPx: number } {
  const tag = rootTag(svg);
  // viewBox separators may be whitespace OR commas per the SVG spec.
  const vb = tag.match(
    /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i,
  );
  if (vb) {
    const w = Number.parseFloat(vb[1]);
    const h = Number.parseFloat(vb[2]);
    if (w > 0 && h > 0) return { wPx: w, hPx: h };
  }
  const wm = tag.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const hm = tag.match(/\bheight\s*=\s*["']([\d.]+)/i);
  return {
    wPx: wm ? Number.parseFloat(wm[1]) : 0,
    hPx: hm ? Number.parseFloat(hm[1]) : 0,
  };
}

// A path's operational color: stroke wins over fill (a stroked line is a cut path);
// both attribute and inline-style forms are read. "none" is skipped.
function colorOf(tag: string): string {
  const stroke =
    tag.match(/\bstroke\s*=\s*["']([^"']+)/i)?.[1] ??
    tag.match(/stroke\s*:\s*([^;"']+)/i)?.[1];
  const fill =
    tag.match(/\bfill\s*=\s*["']([^"']+)/i)?.[1] ??
    tag.match(/fill\s*:\s*([^;"']+)/i)?.[1];
  for (const c of [stroke, fill]) {
    const v = c?.trim().toLowerCase();
    if (v && v !== "none") return v;
  }
  return "#000000";
}

function extractPaths(svg: string): { d: string; color: string }[] {
  const tags = svg.match(/<path\b[^>]*>/gi) ?? [];
  const out: { d: string; color: string }[] = [];
  for (const tag of tags) {
    const d =
      tag.match(/\bd\s*=\s*"([^"]+)"/i)?.[1] ??
      tag.match(/\bd\s*=\s*'([^']+)'/i)?.[1];
    if (d) out.push({ d, color: colorOf(tag) });
  }
  return out;
}

// Split a path's `d` into its subpaths (each begins with M/m). Needed so the fill
// area is shoelaced PER closed ring instead of bridged across rings.
function splitSubpaths(d: string): string[] {
  return d.match(/[Mm][^Mm]*/g) ?? [];
}

// Signed shoelace of a closed subpath, sampled into points. Sign carries winding so
// opposite-wound holes subtract from the region they sit in. Translation-invariant,
// so a relative "m" subpath parsed standalone still measures the right area.
function closedSubpathArea(sub: string): number {
  try {
    const sp = new svgPathProperties(sub);
    const sl = sp.getTotalLength();
    if (!Number.isFinite(sl) || sl <= 0) return 0;
    const m = Math.max(12, Math.min(400, Math.round(sl / 12)));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= m; i++) pts.push(sp.getPointAtLength((sl * i) / m));
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  } catch {
    return 0;
  }
}

export function parseSvgGeometry(svg: string): SvgGeometry {
  const viewport = parseViewport(svg);
  const paths = extractPaths(svg);

  const byColor = new Map<string, number>();
  let totalLengthPx = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let inkAreaPx2 = 0;

  for (const { d, color } of paths) {
    try {
      // Malformed path data throws here — caught below, skipped, parse continues.
      const whole = new svgPathProperties(d);
      const len = whole.getTotalLength();
      if (!Number.isFinite(len) || len <= 0) continue;

      totalLengthPx += len;
      byColor.set(color, (byColor.get(color) ?? 0) + len);

      // Bounding box from whole-path samples (absolute positions intact).
      const n = Math.max(24, Math.min(600, Math.round(len / 12)));
      for (let i = 0; i <= n; i++) {
        const p = whole.getPointAtLength((len * i) / n);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      // Fill area: only CLOSED subpaths contribute (open cut/score lines add none),
      // each shoelaced independently and summed signed so holes subtract, then abs.
      let signed = 0;
      for (const sub of splitSubpaths(d)) {
        if (/[zZ]/.test(sub)) signed += closedSubpathArea(sub);
      }
      inkAreaPx2 += Math.abs(signed);
    } catch {
      // skip this path
    }
  }

  const bboxWpx = Number.isFinite(maxX) ? maxX - minX : 0;
  const bboxHpx = Number.isFinite(maxY) ? maxY - minY : 0;
  const bboxArea = bboxWpx * bboxHpx;
  const fillFractionEstimate =
    bboxArea > 0 ? Math.min(1, inkAreaPx2 / bboxArea) : 0;

  return {
    // Fall back to the geometry bbox when width/height/viewBox are absent.
    viewport: {
      wPx: viewport.wPx > 0 ? viewport.wPx : bboxWpx,
      hPx: viewport.hPx > 0 ? viewport.hPx : bboxHpx,
    },
    bboxPx: { wPx: bboxWpx, hPx: bboxHpx },
    totalLengthPx,
    layers: [...byColor.entries()].map(([color, lengthPx]) => ({
      color,
      lengthPx,
    })),
    fillFractionEstimate,
    pathCount: paths.length,
  };
}

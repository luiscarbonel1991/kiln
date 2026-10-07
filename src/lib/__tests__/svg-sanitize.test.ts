import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "@/lib/svg-sanitize";

describe("sanitizeSvg", () => {
  it("keeps the drawing and drops what could run or reach out", () => {
    const svg = `<?xml version="1.0"?><?xml-stylesheet href="http://x/s.css"?><!DOCTYPE svg [<!ENTITY e SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
<script>alert(1)</script><foreignObject><div>hi</div></foreignObject>
<style>@import url(http://x/a.css); .a{fill:url(http://x/p)}</style>
<a href="https://evil.example"><path d="M0 0h10v10z" fill="#5B3A29" onclick='x()'/></a>
<use href="#p"/><image href="data:image/png;base64,AAAA"/><image xlink:href="http://x/i.png"/>
<path fill="url(#g)" d="M1 1"/></svg>`;
    const clean = sanitizeSvg(svg) ?? "";
    for (const gone of [
      "script",
      "foreignObject",
      "onload",
      "onclick",
      "@import",
      "evil.example",
      "http://x/i.png",
      "http://x/p",
      "ENTITY",
      "xml-stylesheet",
    ]) {
      expect(clean).not.toContain(gone);
    }
    expect(clean).toContain('<path d="M0 0h10v10z" fill="#5B3A29"/>');
    expect(clean).toContain('href="#p"');
    expect(clean).toContain('href="data:image/png;base64,AAAA"');
    expect(clean).toContain('fill="url(#g)"');
  });

  it("refuses what is not an SVG, or still carries a javascript: link", () => {
    expect(sanitizeSvg("<html><body/></html>")).toBeNull();
    expect(
      sanitizeSvg('<svg><a style="x" data-x="javascript:alert(1)"/></svg>'),
    ).toBeNull();
  });
});

import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rasterize } from "@/providers/plates/svg";

// A real trace of a small drawing with specks around it: each detail keeps
// a valid SVG, and "clean" drops the specks "fine" keeps. The image is read
// and the SVG stored through stubs.

const s = vi.hoisted(() => ({
  png: Buffer.alloc(0),
  stored: [] as string[],
}));

vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async () => ({
    bytes: s.png,
    base64: s.png.toString("base64"),
    mime: "image/png",
  }),
  storeAsset: async (bytes: Buffer, mime: string) => {
    expect(mime).toBe("image/svg+xml");
    s.stored.push(bytes.toString("utf8"));
    return `https://stub.local/vectors/${s.stored.length}.svg`;
  },
}));

const { traceToVector } = await import("@/server/vectorize");

const specks = Array.from(
  { length: 24 },
  (_, i) =>
    `<rect x="${12 + (i % 6) * 34}" y="${10 + Math.floor(i / 6) * 8}" width="2" height="2"/>`,
).join("");
s.png = Buffer.from(
  rasterize(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="220" height="220"><rect width="220" height="220" fill="#fff"/><circle cx="110" cy="130" r="60" fill="none" stroke="#000" stroke-width="10"/><path d="M60 130 Q110 60 160 130" fill="none" stroke="#000" stroke-width="6"/><g fill="#000">${specks}</g></svg>`,
    220,
    "#ffffff",
  ),
);

const hasAutotrace = (() => {
  try {
    execFileSync("autotrace", ["-version"], { stdio: "ignore" });
    execFileSync("magick", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

afterEach(() => {
  s.stored.length = 0;
});

describe("traceToVector", () => {
  it("traces an outline at each detail, and the clean one drops the specks", async () => {
    const fine = await traceToVector(
      "https://stub.local/a.png",
      "outline",
      "fine",
    );
    const balanced = await traceToVector(
      "https://stub.local/a.png",
      "outline",
      "balanced",
    );
    const clean = await traceToVector(
      "https://stub.local/a.png",
      "outline",
      "clean",
    );
    for (const traced of [fine, balanced, clean]) {
      expect(traced).toMatchObject({
        url: expect.stringMatching(/\.svg$/),
        shapes: expect.any(Number),
      });
    }
    for (const svg of s.stored) expect(svg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    if ("error" in fine || "error" in clean) return;
    expect(clean.shapes).toBeGreaterThan(0);
    expect(clean.shapes).toBeLessThan(fine.shapes);
    expect(clean.bytes).toBeLessThan(fine.bytes);
  });

  it.skipIf(!hasAutotrace)(
    "traces a centerline with the system's autotrace",
    async () => {
      const traced = await traceToVector(
        "https://stub.local/a.png",
        "centerline",
        "clean",
      );
      expect(traced).toMatchObject({ url: expect.stringMatching(/\.svg$/) });
    },
  );
});

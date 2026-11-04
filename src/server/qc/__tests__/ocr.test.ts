import { afterEach, describe, expect, it, vi } from "vitest";

// The engine is settled once per process from KILN_OCR, so each case loads
// the module afresh.
async function engineWith(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  vi.resetModules();
  const { ocrEngine } = await import("@/server/qc/ocr");
  return ocrEngine();
}

const platform = process.platform;

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(process, "platform", { value: platform });
});

describe("ocrEngine", () => {
  it("is off when KILN_OCR is none, and says so", async () => {
    expect(await engineWith({ KILN_OCR: "none" })).toEqual({
      none: "the take check is off (KILN_OCR=none)",
    });
  });

  it("names the package to install when Tesseract is missing", async () => {
    const engine = await engineWith({ KILN_OCR: "tesseract", PATH: "" });
    expect(engine).toEqual({
      none: expect.stringContaining("apt-get install tesseract-ocr"),
    });
  });

  it("refuses Apple Vision off macOS", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(await engineWith({ KILN_OCR: "vision" })).toEqual({
      none: "Apple Vision runs on macOS only",
    });
  });

  it("defaults to Tesseract off macOS", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const engine = await engineWith({ KILN_OCR: "", PATH: "" });
    expect(engine).toEqual({
      none: expect.stringContaining("Tesseract is not installed"),
    });
  });
});

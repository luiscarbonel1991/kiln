import { describe, expect, it } from "vitest";
import { analyzeMaster } from "@/app/actions/analyze";

describe("analyzeMaster", () => {
  it("returns a BaseUnderstanding with all six fields", async () => {
    const understanding = await analyzeMaster({
      assetUrl: "https://stub.local/x.png",
    });
    expect(understanding.subject).toBeTruthy();
    expect(understanding.materials).toBeTruthy();
    expect(understanding.lighting).toBeTruthy();
    expect(understanding.composition).toBeTruthy();
    expect(understanding.mood).toBeTruthy();
    expect(Array.isArray(understanding.palette)).toBe(true);
    expect(understanding.palette.length).toBeGreaterThan(0);
  });

  it("rejects an empty asset URL", async () => {
    await expect(analyzeMaster({ assetUrl: "" })).rejects.toThrow();
  });
});

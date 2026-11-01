import { describe, expect, it } from "vitest";
import { paramChoices } from "@/components/studio/model-params";

describe("paramChoices", () => {
  it("a video card offers vertical and landscape only, and no guidance or strength", () => {
    const video = paramChoices("9:16", true);
    expect(video.aspects.map((a) => a.value)).toEqual(["9:16", "16:9"]);
    expect(video.tuning).toBe(false);
    expect(paramChoices("16:9", true).aspect).toBe("16:9");
    // An aspect a video does not render shows as what it renders: vertical.
    expect(paramChoices("4:5", true).aspect).toBe("9:16");
  });

  it("an image card keeps every aspect and its tuning", () => {
    const image = paramChoices("4:5", false);
    expect(image.aspects).toHaveLength(7);
    expect(image).toMatchObject({ aspect: "4:5", tuning: true });
  });
});

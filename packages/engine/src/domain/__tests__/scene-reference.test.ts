import { describe, expect, it } from "vitest";
import {
  kilnPick,
  sceneReference,
  ThreeQuarterView,
  threeQuarterFor,
} from "@/domain/scene-reference";

const view = ThreeQuarterView.parse({
  assetUrl: "https://stub.local/plates/above.png",
  angleDeg: 30,
  front: "https://stub.local/plates/front.png",
});
const master = {
  id: "plate-p",
  assetUrl: "https://stub.local/plates/front.png",
};

describe("the view from above", () => {
  it("applies while the project's reference is the front it was drawn beside", () => {
    expect(threeQuarterFor({ threeQuarter: view }, master.assetUrl)).toBe(view);
    expect(
      threeQuarterFor({ threeQuarter: view }, "https://stub.local/mine.jpg"),
    ).toBeNull();
    expect(threeQuarterFor(undefined, master.assetUrl)).toBeNull();
  });

  it("Kiln picks a little above for a scene that offers the camera", () => {
    expect(kilnPick({ camera: "eye", distance: "medium" }, view)).toEqual({
      camera: "above",
    });
    expect(kilnPick({ distance: "close" }, view)).toEqual({});
    expect(kilnPick({ camera: "eye" }, null)).toEqual({});
    expect(kilnPick(undefined, view)).toEqual({});
  });

  it("a scene looking down edits the view from above; any other the front", () => {
    expect(sceneReference("above", master, view)).toEqual({
      ...master,
      assetUrl: view.assetUrl,
    });
    expect(sceneReference("overhead", master, view).assetUrl).toBe(
      view.assetUrl,
    );
    for (const camera of ["eye", "any", undefined] as const) {
      expect(sceneReference(camera, master, view)).toBe(master);
    }
    expect(sceneReference("above", master, null)).toBe(master);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildVideoRequest,
  GenerationRequest,
  VideoNeedsScene,
} from "@/domain/generation-request";
import type { VideoSettings } from "@/domain/plan";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

// A plate with raised white lettering, 1/8 in proud.
const plate = {
  ...CUTTING_BOARD,
  name: "Door plate",
  material: "matte panel",
  treatment: "raised" as const,
  dimensions: { w: 5, h: 3, relief: 0.125, unit: "in" as const },
  colours: [
    {
      key: "black",
      name: "Black Matte",
      face: "#1A1A1A",
      inlay: "#FFFFFF",
      inStock: true,
    },
  ],
  defaultColour: "black",
};

const settings: VideoSettings = {
  from: "in-use",
  startFrame: "http://localhost:9000/kiln-assets/cards/in-use.png",
  motion: "push-in",
  seconds: 8,
  orientation: "portrait",
  allowed: [8, 12],
};

describe("buildVideoRequest", () => {
  it("animates the approved scene, with the product from its spec and locked", () => {
    const request = buildVideoRequest({
      product: plate,
      settings,
      scene: "beside a video doorbell on an exterior wall.",
    });
    expect(request).toMatchObject({
      kind: "video",
      startFrameUrl: settings.startFrame,
      durationSec: 8,
      motion: "a subtle, slow push-in toward the product",
      model: {
        provider: "google",
        model: "veo-3.1-fast-generate-preview",
        resolution: "720p",
        aspect: "9:16",
      },
    });
    expect(request.prompt).toContain(
      "white raised elements standing 1/8 in proud of the face",
    );
    expect(request.prompt).toContain(
      "The scene stays the start frame's: beside a video doorbell on an exterior wall.",
    );
    expect(request.prompt).toContain(
      "every letter of its wording, its colours and finish",
    );
    expect(request.prompt).toContain("only the camera and the light move");
    expect(request.prompt).toContain(
      "Add no text, captions, logos, people or new objects. Never: flat printed lettering",
    );
    expect(request.prompt).toContain("exactly as in the start frame");
    expect(request.prompt).not.toContain("master image");
    expect(GenerationRequest.parse(request)).toEqual(request);
  });

  it("goes landscape and follows the motion and length chosen", () => {
    const request = buildVideoRequest({
      product: plate,
      settings: {
        ...settings,
        orientation: "landscape",
        motion: "light",
        seconds: 12,
      },
    });
    expect(request.model.aspect).toBe("16:9");
    expect(request.durationSec).toBe(12);
    expect(request.motion).toContain("static camera");
  });

  it("never without an approved scene: no new image is made to animate", () => {
    expect(() =>
      buildVideoRequest({
        product: plate,
        settings: { ...settings, from: null, startFrame: null },
      }),
    ).toThrow(VideoNeedsScene);
  });
});

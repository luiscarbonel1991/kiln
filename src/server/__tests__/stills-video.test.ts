import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderStills } from "@/server/stills-video";

const has = (bin: string, flag: string) => {
  try {
    execFileSync(bin, [flag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const ready = has("ffmpeg", "-version") && has("magick", "-version");

const scene = (size: string, colour: string) =>
  new Uint8Array(
    execFileSync("magick", ["-size", size, `xc:${colour}`, "png:-"]),
  );

// The video's length and size, read by ffprobe.
const probe = (mp4: Uint8Array) =>
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height,codec_name",
      "-of",
      "json",
      "-",
    ],
    { input: mp4 },
  ).toString();

describe.skipIf(!ready)("renderStills", { timeout: 60_000 }, () => {
  it("makes an H.264 video of the length asked, at 720p in the orientation asked", async () => {
    const mp4 = await renderStills(
      [
        scene("800x1000", "#3F5F3A"),
        scene("1000x1000", "#D3B66F"),
        scene("1500x1000", "#C0461F"),
      ],
      { seconds: 10, orientation: "portrait" },
    );
    const read = JSON.parse(probe(mp4));
    expect(read.streams[0]).toMatchObject({
      codec_name: "h264",
      width: 720,
      height: 1280,
    });
    expect(Number(read.format.duration)).toBeCloseTo(10, 0);
    // No audio stream.
    expect(read.streams).toHaveLength(1);
  });

  it("shows one scene alone, landscape, and refuses none", async () => {
    const mp4 = await renderStills([scene("1000x1000", "#1B1B1B")], {
      seconds: 8,
      orientation: "landscape",
    });
    const read = JSON.parse(probe(mp4));
    expect(read.streams[0]).toMatchObject({ width: 1280, height: 720 });
    expect(Number(read.format.duration)).toBeCloseTo(8, 0);
    await expect(
      renderStills([], { seconds: 8, orientation: "portrait" }),
    ).rejects.toThrow("no approved scene");
  });
});

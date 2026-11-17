import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type SlotRef, slotCardId, videoSettings } from "@/domain/plan";
import type { VideoOrientation } from "@/domain/video";
import { CATALOG } from "@/lib/recipes";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import type { MakerRef } from "@/server/maker-repository";
import { loadProjectBoard, setStillsVideo } from "@/server/project-repository";

const run = promisify(execFile);

const FPS = 30;
// A slide between two scenes, in seconds. Slides, not crossfades: a crossfade
// doubled the lettering of two plates on screen (DOGFOOD #45).
const SLIDE = 0.5;
// How far each scene zooms in over its time on screen: little, so a scene
// fitted edge to edge loses almost nothing.
const ZOOM = 0.05;

const SIZE: Record<VideoOrientation, { width: number; height: number }> = {
  portrait: { width: 720, height: 1280 },
  landscape: { width: 1280, height: 720 },
};

// A listing video made from the approved scenes, free and local (DOGFOOD
// #45): each scene on screen in turn with a slow zoom, sliding to the next;
// no audio, the scenes exactly as approved. ffmpeg, H.264 at 720p.
export async function renderStills(
  scenes: Uint8Array[],
  options: { seconds: number; orientation: VideoOrientation },
): Promise<Uint8Array> {
  if (scenes.length === 0) throw new Error("no approved scene to show");
  const { width, height } = SIZE[options.orientation];
  const n = scenes.length;
  // Each scene's time on screen, its slides shared with its neighbours.
  const each = (options.seconds + (n - 1) * SLIDE) / n;
  const frames = Math.round(each * FPS);
  const dir = await mkdtemp(path.join(tmpdir(), "kiln-stills-"));
  try {
    const inputs: string[] = [];
    for (const [i, bytes] of scenes.entries()) {
      const file = path.join(dir, `scene-${i}.img`);
      await writeFile(file, bytes);
      inputs.push("-i", file);
    }
    // Each scene whole in the frame (never cropped: a wide plate keeps its
    // ends), on a blurred copy of itself where the frame is wider or taller,
    // then a slow zoom about its centre.
    const W = width * 2;
    const H = height * 2;
    const zoomed = scenes.map(
      (_, i) =>
        `[${i}:v]split=2[b${i}][f${i}];` +
        `[b${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2[bg${i}];` +
        `[f${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg${i}];` +
        `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,zoompan=z='1+${ZOOM}*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`,
    );
    const slides: string[] = [];
    let last = "v0";
    for (let i = 1; i < n; i++) {
      const out = `x${i}`;
      const offset = (each - SLIDE) * i;
      slides.push(
        `[${last}][v${i}]xfade=transition=slideleft:duration=${SLIDE}:offset=${offset.toFixed(3)}[${out}]`,
      );
      last = out;
    }
    const output = path.join(dir, "stills.mp4");
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...inputs,
        "-filter_complex",
        [...zoomed, ...slides].join(";"),
        "-map",
        `[${last}]`,
        "-t",
        String(options.seconds),
        "-r",
        String(FPS),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        output,
      ],
      { maxBuffer: 16 << 20, timeout: 120_000 },
    );
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Make a project's stills-in-motion video and give it to its video card:
// the destination's approved scenes, the start frame first and the rest in
// their order, at the slot's length and orientation. Free; refused with why.
export async function makeStillsVideo(
  maker: MakerRef,
  projectId: string,
  ref: SlotRef,
): Promise<{ url: string } | { error: string }> {
  const loaded = await loadProjectBoard(maker, projectId);
  const destination = loaded?.board.plan?.destinations.find(
    (d) => d.destinationId === ref.destinationId,
  );
  const slot = destination?.slots.find((s) => s.key === ref.slotKey);
  if (!destination || slot?.fill !== "video") {
    return { error: "That is not a video frame of this project." };
  }
  const settings = videoSettings(
    destination,
    slot,
    CATALOG.destinations.find((d) => d.id === ref.destinationId)?.video,
  );
  if (!settings.stills) {
    return { error: "Choose stills in motion for this video first." };
  }
  const approved = destination.slots.filter(
    (s) => s.fill === "scene" && !s.off && s.approvedOutput,
  );
  const ordered = [
    ...approved.filter((s) => s.key === settings.from),
    ...approved.filter((s) => s.key !== settings.from),
  ];
  if (ordered.length === 0) {
    return {
      error: "Approve a scene first: the video shows the approved scenes.",
    };
  }
  try {
    const scenes = await Promise.all(
      ordered.map(
        async (s) => (await fetchAsset(s.approvedOutput ?? "")).bytes,
      ),
    );
    const mp4 = await renderStills(
      scenes.map((b) => new Uint8Array(b)),
      { seconds: settings.seconds, orientation: settings.orientation },
    );
    const url = await storeAsset(mp4, "video/mp4", "stills");
    await setStillsVideo(
      maker,
      projectId,
      slotCardId(ref.destinationId, ref.slotKey),
      url,
    );
    return { url };
  } catch (error) {
    return {
      error: `The video could not be made: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

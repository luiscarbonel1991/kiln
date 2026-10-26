import { execFileSync } from "node:child_process";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DestinationProfile } from "@/domain/destination";
import { imageSize, rasterType } from "@/domain/image-type";
import { PlanDestination } from "@/domain/plan";
import { parseProductPackage } from "@/domain/product-package";
import { buildDelivery, DeliveryRefusal } from "@/server/deliver/delivery";
import pkg from "../../lib/__fixtures__/product-package.json";

const parsed = parseProductPackage(pkg);
if (!parsed.ok) throw new Error("fixture package does not parse");
const coaster = parsed.products[1];

const etsy = DestinationProfile.parse({
  id: "etsy",
  name: "Etsy",
  kind: "sale",
  formats: [
    { key: "square", label: "Square", aspect: "1:1", minPx: 2000 },
    { key: "portrait", label: "Portrait", aspect: "4:5", minPx: 2000 },
  ],
  rules: { textOnImage: "forbidden", negative: [] },
  delivery: { mode: "draft-api" },
});

const IN_USE = "https://storage.test/cards/in-use.png";
const HERO = "https://storage.test/cards/hero.png";
const CLIP = "https://storage.test/cards/clip.mp4";

const plan = PlanDestination.parse({
  destinationId: "etsy",
  shotListId: "etsy-listing",
  slots: [
    {
      key: "in-use",
      label: "In use",
      purpose: "p",
      aspect: "4:5",
      approvedOutput: IN_USE,
    },
    {
      key: "hero",
      label: "Hero",
      purpose: "p",
      aspect: "1:1",
      approvedOutput: HERO,
    },
    {
      key: "colours",
      label: "Colours",
      purpose: "p",
      aspect: "1:1",
      fill: "exact",
      exact: "colour-grid",
    },
    {
      key: "scale",
      label: "Scale",
      purpose: "p",
      aspect: "1:1",
      fill: "exact",
      exact: "scale",
    },
    { key: "gift", label: "Gift", purpose: "p", aspect: "4:5", off: true },
    {
      key: "video",
      label: "Listing video",
      purpose: "p",
      aspect: "9:16",
      fill: "video",
      approvedOutput: CLIP,
    },
  ],
});

const hasMagick = (() => {
  try {
    execFileSync("magick", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

const png = (size: string) =>
  new Uint8Array(
    execFileSync("magick", [
      "-size",
      size,
      "gradient:#D9B98C-#3F5F3A",
      "png:-",
    ]),
  );

const input = (overrides = {}) => ({
  projectName: "Botanical coaster — Launch",
  product: coaster,
  brand: null,
  destination: etsy,
  plan,
  cardOf: (key: string) =>
    ({
      "in-use": { status: "done" as const, outputs: [IN_USE] },
      hero: { status: "done" as const, outputs: [HERO] },
      video: { status: "done" as const, outputs: [CLIP] },
    })[key],
  plate: null,
  fetchOutput: async (url: string) =>
    url === CLIP
      ? new TextEncoder().encode("mp4 bytes")
      : url === IN_USE
        ? png("1024x1536")
        : png("1024x1024"),
  sourceOf: (url: string) =>
    url === CLIP
      ? {
          prompt: "animate the start frame",
          model: "sora-2",
          costMicros: 800_000,
          generatedAt: "2026-10-06T09:00:00.000Z",
          seconds: 8,
          aspect: "9:16",
        }
      : url === HERO
        ? {
            prompt: "a hero",
            model: "gpt-image-2",
            costMicros: 61_000,
            generatedAt: "2026-10-04T12:00:00.000Z",
          }
        : undefined,
  now: new Date("2026-10-06T10:00:00.000Z"),
  ...overrides,
});

// Renders 2000 px frames and upscales with ImageMagick: slow on a busy machine.
describe.skipIf(!hasMagick)("buildDelivery", { timeout: 30_000 }, () => {
  it("zips every slot switched on, in order, at the destination's pixel target", async () => {
    const result = await buildDelivery(input());
    expect(result.filename).toBe("botanical-coaster-launch-etsy.zip");
    const files = unzipSync(result.zip);
    const folder = "botanical-coaster-launch-etsy";
    expect(Object.keys(files).sort()).toEqual(
      [
        "01-in-use.jpg",
        "02-hero.jpg",
        "03-colours.png",
        "04-scale.png",
        "README.txt",
        "manifest.json",
        "video.mp4",
      ].map((f) => `${folder}/${f}`),
    );
    // Read from each file's header: an identify through a pipe could hang.
    const size = (bytes: Uint8Array) => {
      const read = imageSize(bytes);
      return read ? `${read.width} ${read.height}` : "unreadable";
    };
    expect(size(files[`${folder}/01-in-use.jpg`])).toBe("2000 2500");
    expect(size(files[`${folder}/02-hero.jpg`])).toBe("2000 2000");
    expect(size(files[`${folder}/03-colours.png`])).toBe("2000 2000");
    const manifest = JSON.parse(strFromU8(files[`${folder}/manifest.json`]));
    expect(
      manifest.files.map((f: { photo: number | null }) => f.photo),
    ).toEqual([1, 2, 3, 4, null]);
    expect(manifest.files[4]).toMatchObject({
      file: "video.mp4",
      kind: "video",
      width: 720,
      height: 1280,
      seconds: 8,
      source: { model: "sora-2", costMicros: 800_000 },
    });
    expect(strFromU8(files[`${folder}/video.mp4`])).toBe("mp4 bytes");
    expect(strFromU8(files[`${folder}/README.txt`])).toContain(
      "Listing video: botanical-coaster-launch-etsy/video.mp4",
    );
    expect(manifest.files[1].source).toMatchObject({
      model: "gpt-image-2",
      costMicros: 61_000,
    });
    expect(strFromU8(files[`${folder}/README.txt`])).toContain(
      "photo 1 is the listing's thumbnail",
    );
    expect(result.delivered).toEqual([
      { key: "in-use", approvedOutput: IN_USE },
      { key: "hero", approvedOutput: HERO },
      { key: "colours" },
      { key: "scale" },
      { key: "video", approvedOutput: CLIP },
    ]);
  });

  it("delivers the maker's own photos as they are, numbered in their place; a WebP as a JPEG", async () => {
    const LIVE_1 = "https://storage.test/listings/live-1.png";
    const LIVE_3 = "https://storage.test/listings/live-3.webp";
    const kept = png("800x600");
    const webp = new Uint8Array(
      execFileSync("magick", ["-size", "900x600", "xc:#D9B98C", "webp:-"]),
    );
    const live = PlanDestination.parse({
      destinationId: "etsy",
      shotListId: "etsy-listing",
      listingUrl: "https://www.etsy.com/listing/123/coaster",
      slots: [
        {
          key: "live-1",
          label: "Your photo",
          purpose: "p",
          aspect: "4:3",
          fill: "photo",
          photo: LIVE_1,
        },
        {
          key: "hero",
          label: "Hero",
          purpose: "p",
          aspect: "1:1",
          approvedOutput: HERO,
          before: { url: LIVE_3, aspect: "3:2" },
        },
        {
          key: "live-3",
          label: "Your photo",
          purpose: "p",
          aspect: "3:2",
          fill: "photo",
          photo: LIVE_3,
        },
      ],
    });
    const result = await buildDelivery(
      input({
        plan: live,
        fetchOutput: async (url: string) =>
          url === LIVE_1 ? kept : url === LIVE_3 ? webp : png("1024x1024"),
      }),
    );
    const files = unzipSync(result.zip);
    const folder = "botanical-coaster-launch-etsy";
    expect(Object.keys(files).sort()).toEqual(
      [
        "01-live-1.png",
        "02-hero.jpg",
        "03-live-3.jpg",
        "README.txt",
        "manifest.json",
      ].map((f) => `${folder}/${f}`),
    );
    // As it is: the same bytes.
    expect(Buffer.from(files[`${folder}/01-live-1.png`]).equals(kept)).toBe(
      true,
    );
    const asJpeg = files[`${folder}/03-live-3.jpg`];
    expect(rasterType(asJpeg)).toBe("image/jpeg");
    expect(imageSize(asJpeg)).toEqual({ width: 900, height: 600 });
    expect(strFromU8(files[`${folder}/README.txt`])).toContain(
      `1. ${folder}/01-live-1.png — Your photo (your photo, as on the listing), 800 x 600 px`,
    );
    const manifest = JSON.parse(strFromU8(files[`${folder}/manifest.json`]));
    expect(manifest.files[2]).toMatchObject({
      file: "03-live-3.jpg",
      photo: 3,
      kind: "photo",
      output: LIVE_3,
    });
    expect(result.delivered).toEqual([
      { key: "live-1" },
      { key: "hero", approvedOutput: HERO },
      { key: "live-3" },
    ]);
  });

  it("a Veo clip keeps its size by resolution and names its model", async () => {
    const result = await buildDelivery(
      input({
        sourceOf: (url: string) =>
          url === CLIP
            ? {
                prompt: "animate the start frame",
                provider: "google",
                model: "veo-3.1-fast-generate-preview",
                label: "Veo 3.1 Fast",
                costMicros: 960_000,
                generatedAt: "2026-10-06T09:00:00.000Z",
                seconds: 8,
                aspect: "9:16",
                resolution: "1080p",
              }
            : undefined,
      }),
    );
    const files = unzipSync(result.zip);
    const folder = "botanical-coaster-launch-etsy";
    const manifest = JSON.parse(strFromU8(files[`${folder}/manifest.json`]));
    expect(manifest.files[4]).toMatchObject({
      file: "video.mp4",
      width: 1080,
      height: 1920,
      seconds: 8,
    });
    expect(strFromU8(files[`${folder}/README.txt`])).toContain(
      "(approved, 8 s, Veo 3.1 Fast), 1080 x 1920 px",
    );
  });

  it("a destination with text rules carries the listing as the paste sheet and as data", async () => {
    const { SEED_DESTINATIONS } = await import("@/domain/seed");
    const { listingDraft } = await import("@/domain/listing");
    const rules = SEED_DESTINATIONS.find((d) => d.id === "etsy")?.text;
    if (!rules) throw new Error("Etsy has no text rules");
    const listing = listingDraft(coaster, rules);
    const result = await buildDelivery(
      input({ destination: { ...etsy, text: rules }, listing }),
    );
    const files = unzipSync(result.zip);
    const folder = "botanical-coaster-launch-etsy";
    const sheet = strFromU8(files[`${folder}/listing.txt`]);
    expect(sheet).toContain("[1] TITLE");
    expect(sheet.indexOf("[1] TITLE")).toBeLessThan(sheet.indexOf("[5] TAGS"));
    expect(JSON.parse(strFromU8(files[`${folder}/listing.json`]))).toEqual(
      listing,
    );
    expect(strFromU8(files[`${folder}/README.txt`])).toContain("listing.txt");
    // Without text rules, no sheet.
    const plain = unzipSync((await buildDelivery(input({ listing }))).zip);
    expect(plain[`${folder}/listing.txt`]).toBeUndefined();
  });

  it("refuses until every scene switched on is approved", async () => {
    await expect(
      buildDelivery(
        input({
          cardOf: () => ({
            status: "done" as const,
            outputs: ["https://x/new.png"],
          }),
        }),
      ),
    ).rejects.toThrow(DeliveryRefusal);
  });
});

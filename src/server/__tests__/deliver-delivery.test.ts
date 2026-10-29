import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("draws a scene's headline over the approved image, as the board shows it", async () => {
    const instagram = DestinationProfile.parse({
      id: "instagram",
      name: "Instagram",
      kind: "content",
      formats: [{ key: "feed", label: "Feed", aspect: "4:5", minPx: 1080 }],
      rules: { textOnImage: "allowed", negative: [] },
      delivery: { mode: "export" },
    });
    const carousel = PlanDestination.parse({
      destinationId: "instagram",
      shotListId: "instagram-carousel",
      slots: [
        {
          key: "hook",
          label: "Hook",
          purpose: "p",
          aspect: "4:5",
          textTemplate: "{product.hook}",
          approvedOutput: HERO,
        },
      ],
    });
    const result = await buildDelivery(
      input({
        destination: instagram,
        plan: carousel,
        cardOf: () => ({ status: "done" as const, outputs: [HERO] }),
        brand: { palette: ["#c0461f"] },
      }),
    );
    const files = unzipSync(result.zip);
    const folder = "botanical-coaster-launch-instagram";
    const slide = files[`${folder}/01-hook.jpg`];
    expect(imageSize(slide)).toEqual({ width: 1080, height: 1350 });
    // The band in the brand's first colour sits over the top-left of the
    // image (the gradient there is a light tan).
    const dir = mkdtempSync(join(tmpdir(), "kiln-test-"));
    const file = join(dir, "slide.jpg");
    writeFileSync(file, slide);
    const [r, g, b] = execFileSync("magick", [
      file,
      "-format",
      "%[fx:int(255*p{60,60}.r)] %[fx:int(255*p{60,60}.g)] %[fx:int(255*p{60,60}.b)]",
      "info:",
    ])
      .toString()
      .split(" ")
      .map(Number);
    rmSync(dir, { recursive: true, force: true });
    expect(Math.abs(r - 0xc0)).toBeLessThan(24);
    expect(Math.abs(g - 0x46)).toBeLessThan(24);
    expect(Math.abs(b - 0x1f)).toBeLessThan(24);
    const manifest = JSON.parse(strFromU8(files[`${folder}/manifest.json`]));
    expect(manifest.files[0]).toMatchObject({
      file: "01-hook.jpg",
      kind: "scene",
      text: coaster.hook,
    });
    const readme = strFromU8(files[`${folder}/README.txt`]);
    expect(readme).toContain("slide 1 is the cover");
    expect(readme).toContain(`with "${coaster.hook}" drawn by Kiln`);
  });

  it("a story is posted on its own, and a shared slide says where its scene comes from", async () => {
    const STORY = "https://storage.test/cards/story.png";
    const instagram = DestinationProfile.parse({
      id: "instagram",
      name: "Instagram",
      kind: "content",
      formats: [
        { key: "feed", label: "Feed", aspect: "4:5", minPx: 1080 },
        { key: "story", label: "Story", aspect: "9:16", minPx: 1080 },
      ],
      rules: { textOnImage: "allowed", negative: [] },
      delivery: { mode: "export" },
    });
    const carousel = PlanDestination.parse({
      destinationId: "instagram",
      shotListId: "instagram-carousel",
      slots: [
        {
          key: "hook",
          label: "Hook",
          purpose: "p",
          aspect: "4:5",
          approvedOutput: HERO,
        },
        {
          key: "story",
          label: "Story",
          purpose: "p",
          aspect: "9:16",
          versionOf: "instagram.hook",
          standalone: true,
          approvedOutput: STORY,
        },
        {
          key: "in-place",
          label: "Product in place",
          purpose: "p",
          aspect: "4:5",
          fill: "shared",
          versionOf: "etsy.in-use",
          approvedOutput: IN_USE,
        },
      ],
    });
    const result = await buildDelivery(
      input({
        destination: instagram,
        plan: carousel,
        cardOf: (key: string) =>
          key === "story"
            ? { status: "done" as const, outputs: [STORY] }
            : key === "hook"
              ? { status: "done" as const, outputs: [HERO] }
              : undefined,
        fetchOutput: async () => png("1024x1536"),
        markOf: (slot: { versionOf?: string; fill: string }) =>
          slot.fill === "shared"
            ? "same scene as Etsy · In-use mockup"
            : slot.versionOf
              ? "re-frames Hook"
              : undefined,
      }),
    );
    const files = unzipSync(result.zip);
    const folder = "botanical-coaster-launch-instagram";
    expect(Object.keys(files).sort()).toEqual(
      [
        "01-hook.jpg",
        "02-in-place.jpg",
        "README.txt",
        "manifest.json",
        "story.jpg",
      ].map((f) => `${folder}/${f}`),
    );
    expect(imageSize(files[`${folder}/story.jpg`])).toEqual({
      width: 1080,
      height: 1920,
    });
    const manifest = JSON.parse(strFromU8(files[`${folder}/manifest.json`]));
    expect(
      manifest.files.map((f: { file: string; photo: number | null }) => [
        f.file,
        f.photo,
      ]),
    ).toEqual([
      ["01-hook.jpg", 1],
      ["story.jpg", null],
      ["02-in-place.jpg", 2],
    ]);
    const readme = strFromU8(files[`${folder}/README.txt`]);
    expect(readme).toContain(`On its own: ${folder}/story.jpg — Story`);
    expect(readme).toContain("re-frames Hook");
    expect(readme).toContain("same scene as Etsy · In-use mockup");
    expect(readme.indexOf("2. ")).toBeLessThan(readme.indexOf("On its own"));
  });

  it("the README says why: the market brief with its sources and dates, and a scene's own place", async () => {
    const briefed = PlanDestination.parse({
      ...plan,
      slots: plan.slots.map((s) =>
        s.key === "hero" ? { ...s, place: "a sunny window ledge" } : s,
      ),
      brief: {
        searches: [
          {
            term: "cork coaster",
            searches: 5700,
            results: 27000,
            conversion: "high",
            price: { low: 14.4, high: 17.6 },
            source: "Etsy Marketplace Insights",
            readOn: "2026-09-27",
          },
          { term: "coaster set", source: "Typed", readOn: "2026-10-01" },
        ],
        notes: [
          {
            term: "cork coaster",
            note: "Close crops on a wooden table, a mug beside it.",
            place: "a sunny window ledge",
            readOn: "2026-10-01",
          },
        ],
      },
    });
    const result = await buildDelivery(input({ plan: briefed }));
    const files = unzipSync(result.zip);
    const folder = "botanical-coaster-launch-etsy";
    const readme = strFromU8(files[`${folder}/README.txt`]);
    expect(readme).toContain(
      "Hero (approved scene, gpt-image-2, at a sunny window ledge)",
    );
    expect(readme).toContain("Market brief (why these photos):");
    expect(readme).toContain(
      '- Leads with "cork coaster": 5700 searches a month, 27000 results, high conversion, median purchase 14.40–17.60 (Etsy Marketplace Insights, read 2026-09-27).',
    );
    expect(readme).toContain('- Also "coaster set" (Typed, read 2026-10-01).');
    expect(readme).toContain(
      '- Page 1 for "cork coaster": Close crops on a wooden table, a mug beside it. Place: a sunny window ledge. (read 2026-10-01)',
    );
    const manifest = JSON.parse(strFromU8(files[`${folder}/manifest.json`]));
    expect(manifest.brief).toEqual(briefed.brief);
    expect(
      manifest.files.find((f: { slot: string }) => f.slot === "hero").place,
    ).toBe("a sunny window ledge");
    // Without a brief, neither says anything about one.
    const plain = unzipSync((await buildDelivery(input())).zip);
    expect(strFromU8(plain[`${folder}/README.txt`])).not.toContain(
      "Market brief",
    );
    expect(
      JSON.parse(strFromU8(plain[`${folder}/manifest.json`])),
    ).not.toHaveProperty("brief");
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

import { execFileSync } from "node:child_process";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DestinationProfile } from "@/domain/destination";
import { PlanDestination } from "@/domain/plan";
import { parseProductPackage } from "@/lib/product-package";
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
    })[key],
  plate: null,
  fetchOutput: async (url: string) =>
    url === IN_USE ? png("1024x1536") : png("1024x1024"),
  sourceOf: (url: string) =>
    url === HERO
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

describe.skipIf(!hasMagick)("buildDelivery", () => {
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
      ].map((f) => `${folder}/${f}`),
    );
    const size = (bytes: Uint8Array) =>
      execFileSync("magick", ["identify", "-format", "%w %h", "-"], {
        input: bytes,
      }).toString();
    expect(size(files[`${folder}/01-in-use.jpg`])).toBe("2000 2500");
    expect(size(files[`${folder}/02-hero.jpg`])).toBe("2000 2000");
    expect(size(files[`${folder}/03-colours.png`])).toBe("2000 2000");
    const manifest = JSON.parse(strFromU8(files[`${folder}/manifest.json`]));
    expect(manifest.files.map((f: { photo: number }) => f.photo)).toEqual([
      1, 2, 3, 4,
    ]);
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
    ]);
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

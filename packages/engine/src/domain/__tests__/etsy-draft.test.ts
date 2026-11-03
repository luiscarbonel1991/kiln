import { describe, expect, it } from "vitest";
import {
  type DraftPhoto,
  DraftSettings,
  draftChanges,
  draftProposal,
  ETSY_MAX_PHOTOS,
  moneyValue,
  whenMadeLabel,
} from "@/domain/etsy-draft";
import { listingDraft } from "@/domain/listing";
import { SEED_DESTINATIONS } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const etsy = SEED_DESTINATIONS.find((d) => d.id === "etsy");
if (!etsy?.text) throw new Error("Etsy has no text rules");
const rules = etsy.text;

const board = { ...CUTTING_BOARD, price: 48 };
const photo = (n: number): DraftPhoto => ({
  file: `${String(n).padStart(2, "0")}-hero.jpg`,
  slot: "hero",
  label: "Hero",
  width: 2000,
  height: 2000,
});
const settings = DraftSettings.parse({
  taxonomyId: 1063,
  quantity: 10,
  readinessStateId: 5,
});

describe("an Etsy draft from the listing kit", () => {
  it("carries the listing's text, the maker's price and the choices Etsy needs", () => {
    const listing = listingDraft(board, rules);
    const proposal = draftProposal({
      product: board,
      listing,
      rules,
      photos: [photo(1), photo(2)],
      settings,
      hasVideo: false,
    });
    expect(proposal.blockers).toEqual([]);
    expect(proposal.fields).toEqual({
      title: listing.title.value.trim(),
      description: listing.description.value.trim(),
      price: 48,
      quantity: 10,
      whoMade: "i_did",
      whenMade: "made_to_order",
      taxonomyId: 1063,
      tags: listing.tags.value,
      materials: listing.materials.value,
      readinessStateId: 5,
    });
    expect(proposal.fields).not.toHaveProperty("state");
    expect(proposal.photos.map((p) => p.file)).toEqual([
      "01-hero.jpg",
      "02-hero.jpg",
    ]);
  });

  it("is held back without a price, a category, a quantity, a processing profile or a photo", () => {
    const product = { ...CUTTING_BOARD, price: undefined };
    const proposal = draftProposal({
      product,
      listing: listingDraft(product, rules),
      rules,
      photos: [],
      settings: DraftSettings.parse({}),
      hasVideo: false,
    });
    expect(proposal.fields).toBeNull();
    expect(proposal.blockers).toEqual([
      expect.stringContaining("Kiln never sets one"),
      "No photo is ready: approve the frames first.",
      "Choose the Etsy category.",
      "Set the quantity.",
      "Choose the processing profile: Etsy needs one for a physical item.",
    ]);
  });

  it("refuses a tag Etsy would split at its comma", () => {
    const listing = listingDraft(board, rules);
    listing.materials = { value: ["walnut, oiled"], source: "maker" };
    const proposal = draftProposal({
      product: board,
      listing,
      rules,
      photos: [photo(1)],
      settings,
      hasVideo: false,
    });
    expect(proposal.blockers).toContain(
      'The material "walnut, oiled" holds a comma: Etsy splits it.',
    );
  });

  it("names what the kit holds and the draft does not carry yet", () => {
    const product = {
      ...board,
      variants: [
        {
          name: "Size",
          values: [
            { key: "m", label: "12 x 8 in", priceExtra: 0 },
            { key: "l", label: "16 x 10 in", priceExtra: 12 },
          ],
        },
      ],
    };
    const listing = listingDraft(product, rules);
    listing.personalization = {
      value: [
        { title: "Name", required: true, maxChars: 20, instructions: "" },
      ],
      source: "maker",
    };
    const photos = Array.from({ length: ETSY_MAX_PHOTOS + 2 }, (_, i) =>
      photo(i + 1),
    );
    const proposal = draftProposal({
      product,
      listing,
      rules,
      photos,
      settings,
      hasVideo: true,
    });
    expect(proposal.photos).toHaveLength(ETSY_MAX_PHOTOS);
    expect(proposal.notSent).toEqual([
      "Photos after the 20th: Etsy takes 20.",
      expect.stringMatching(/^Variations \(Size/),
      "Personalization: set it in Etsy's editor.",
      "The video: upload it in Etsy's editor.",
    ]);
    expect(proposal.fields?.price).toBe(48);
  });
});

describe("what a save changes on Etsy", () => {
  it("lists each field that differs, lists joined", () => {
    expect(
      draftChanges(
        { title: "Oak board", tags: ["oak", "kitchen"], price: 48 },
        { title: "Oak board", tags: ["oak", "gift"], price: 52 },
      ),
    ).toEqual([
      { field: "tags", before: "oak, kitchen", after: "oak, gift" },
      { field: "price", before: "48", after: "52" },
    ]);
  });

  it("names when an item was made as Etsy's form does", () => {
    expect(
      (["made_to_order", "2020_2026", "1990s", "before_1700"] as const).map(
        whenMadeLabel,
      ),
    ).toEqual(["Made to order", "2020–2026", "1990s", "Before 1700"]);
  });

  it("reads Etsy's money as amount over divisor", () => {
    expect(moneyValue({ amount: 4800, divisor: 100 })).toBe(48);
    expect(moneyValue({ amount: 48, divisor: 0 })).toBe(48);
  });
});

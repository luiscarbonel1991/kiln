import { describe, expect, it, vi } from "vitest";

const setListing = vi.fn(async () => {});
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/server/project-repository", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setListing,
}));

const { saveListingAction } = await import("@/app/actions/board");
const { listingDraft } = await import("@/domain/listing");
const { Product } = await import("@/domain/product");

const product = Product.parse({
  id: "x",
  sku: "LT-01",
  name: "Listing test coaster",
  family: "Home",
  dimensions: { w: 4, h: 4 },
  shape: "round coaster",
  material: "slate",
  treatment: "engraved",
  colours: [{ key: "grey", name: "Grey", face: "#555555" }],
  defaultColour: "grey",
  typography: { family: "Hanken Grotesk" },
  source: { kind: "form" },
});

describe("saveListingAction", () => {
  it("saves the listing as the maker left it", async () => {
    const listing = {
      ...listingDraft(product),
      title: { value: "Slate coaster", source: "maker" as const },
    };
    expect(
      await saveListingAction({
        projectId: "p",
        destinationId: "etsy",
        listing,
      }),
    ).toBeUndefined();
    expect(setListing).toHaveBeenCalledWith("p", "etsy", listing);
  });

  it("refuses what is not a listing, in words", async () => {
    setListing.mockClear();
    expect(
      await saveListingAction({
        projectId: "p",
        destinationId: "etsy",
        listing: { title: "no" },
      }),
    ).toEqual({ error: "The listing text could not be read." });
    expect(setListing).not.toHaveBeenCalled();
  });
});

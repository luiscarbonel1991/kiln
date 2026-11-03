import { describe, expect, it, vi } from "vitest";
import type { DraftFields } from "@/domain/etsy-draft";
import { EtsyGuard, EtsyListingImage, etsySend } from "@/providers/shop/etsy";
import {
  etsyDrafts,
  flattenTaxonomy,
  singleOffering,
} from "@/providers/shop/etsy-drafts";
import {
  MOCK_TAXONOMY,
  mockEtsyDrafts,
  newMockDraftStore,
} from "@/providers/shop/etsy-drafts-mock";
import { MOCK_SHOP_ID } from "@/providers/shop/etsy-mock";
import { draftsAllowed, ETSY_SCOPES } from "@/providers/shop/etsy-oauth";

// Writing drafts without a network: fetch is a stub answering in Etsy's
// shapes (its OpenAPI spec, 2026-11-02), and nothing is called.
const app = { keystring: "kstr", sharedSecret: "shh" };
const token = { accessToken: "90001.token" };

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const listing = {
  listing_id: 1501,
  shop_id: 7,
  title: "Oak board",
  url: "https://www.etsy.com/listing/1501",
  state: "draft",
  price: { amount: 4800, divisor: 100, currency_code: "USD" },
  quantity: 10,
  tags: ["oak"],
};

const fields: DraftFields = {
  title: "Oak board",
  description: "An oak board.",
  price: 48,
  quantity: 10,
  whoMade: "i_did",
  whenMade: "made_to_order",
  taxonomyId: 1063,
  tags: ["oak", "kitchen gift"],
  materials: ["oak"],
  readinessStateId: 5,
};

function stub(answer: () => Response) {
  return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
    answer(),
  );
}

describe("etsySend", () => {
  it("sends a form with the shop's token, a list as one comma-joined value", async () => {
    const fetch = stub(() => json(200, listing));
    await etsySend(
      app,
      "PATCH",
      "/shops/7/listings/1501",
      { form: { title: "Oak board", tags: ["oak", "gift"], price: undefined } },
      null,
      { ...token, fetch },
    );
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.etsy.com/v3/application/shops/7/listings/1501",
    );
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({
      "x-api-key": "kstr:shh",
      authorization: "Bearer 90001.token",
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual(
      { title: "Oak board", tags: "oak,gift" },
    );
  });

  it("sends JSON, reads a 204 as nothing, and waits out a 429", async () => {
    let calls = 0;
    const fetch = stub(() =>
      ++calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "2" } })
        : new Response(null, { status: 204 }),
    );
    const wait = vi.fn(async () => {});
    const answer = await etsySend(
      app,
      "PUT",
      "/listings/1501/inventory",
      { json: { products: [] } },
      null,
      { ...token, fetch, wait },
    );
    expect(answer).toBeUndefined();
    expect(wait).toHaveBeenCalledWith(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
      "content-type": "application/json",
    });
    expect(fetch.mock.calls[1][1]?.body).toBe('{"products":[]}');
  });

  it("never sends a listing's state, in any body: nothing is fetched", async () => {
    const fetch = stub(() => json(200, listing));
    const multipart = new FormData();
    multipart.set("state", "active");
    for (const body of [
      { form: { state: "active" } },
      { json: { state: "active" } },
      { multipart },
    ]) {
      await expect(
        etsySend(app, "PATCH", "/shops/7/listings/1501", body, null, {
          ...token,
          fetch,
        }),
      ).rejects.toThrow(EtsyGuard);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes nothing but a listing's photo, and writes nothing without a token", async () => {
    const fetch = stub(() => new Response(null, { status: 204 }));
    await expect(
      etsySend(app, "DELETE", "/listings/1501", undefined, null, {
        ...token,
        fetch,
      }),
    ).rejects.toThrow("deletes nothing");
    await expect(
      etsySend(app, "POST", "/shops/7/listings", { form: {} }, null, {
        fetch,
      }),
    ).rejects.toThrow("needs its token");
    expect(fetch).not.toHaveBeenCalled();
    await etsySend(
      app,
      "DELETE",
      "/shops/7/listings/1501/images/88",
      undefined,
      null,
      { ...token, fetch },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws Etsy's own words, and an answer it cannot read", async () => {
    const refused = stub(() =>
      json(400, { error: "taxonomy_id is not a valid taxonomy" }),
    );
    await expect(
      etsySend(app, "POST", "/shops/7/listings", { form: {} }, null, {
        ...token,
        fetch: refused,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "taxonomy_id is not a valid taxonomy",
    });
    const odd = stub(() => new Response("<html>", { status: 200 }));
    await expect(
      etsySend(
        app,
        "POST",
        "/shops/7/listings/1/images",
        { form: {} },
        EtsyListingImage,
        { ...token, fetch: odd },
      ),
    ).rejects.toThrow("did not read as expected");
  });
});

describe("the draft writer", () => {
  it("makes a physical draft from the fields, never with a state", async () => {
    const fetch = stub(() => json(201, listing));
    const made = await etsyDrafts(app, { ...token, fetch }).createDraft(
      7,
      fields,
    );
    expect(made.listing_id).toBe(1501);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.etsy.com/v3/application/shops/7/listings",
    );
    expect(init?.method).toBe("POST");
    const sent = Object.fromEntries(new URLSearchParams(String(init?.body)));
    expect(sent).toEqual({
      title: "Oak board",
      description: "An oak board.",
      price: "48",
      quantity: "10",
      who_made: "i_did",
      when_made: "made_to_order",
      taxonomy_id: "1063",
      tags: "oak,kitchen gift",
      materials: "oak",
      readiness_state_id: "5",
      type: "physical",
      is_supply: "false",
    });
  });

  it("reads the shop's drafts and one listing with its photos", async () => {
    const fetch = stub(() => json(200, { count: 1, results: [listing] }));
    const writer = etsyDrafts(app, { ...token, fetch });
    const page = await writer.drafts(7, { limit: 25, offset: 0 });
    expect(page.results[0]).toMatchObject({ state: "draft", tags: ["oak"] });
    const drafts = new URL(String(fetch.mock.calls[0][0]));
    expect(drafts.pathname).toBe("/v3/application/shops/7/listings");
    expect(Object.fromEntries(drafts.searchParams)).toEqual({
      state: "draft",
      includes: "Images",
      sort_on: "updated",
      sort_order: "desc",
      limit: "25",
      offset: "0",
    });
    const one = stub(() => json(200, listing));
    await etsyDrafts(app, { ...token, fetch: one }).listing(1501);
    const read = new URL(String(one.mock.calls[0][0]));
    expect(read.pathname + read.search).toBe(
      "/v3/application/listings/1501?includes=Images",
    );
    expect(one.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer 90001.token",
    });
  });

  it("sends a photo as multipart at its rank, and removes one by id", async () => {
    const fetch = stub(() =>
      json(201, { listing_image_id: 88, rank: 2, url_570xN: "https://i/88" }),
    );
    const writer = etsyDrafts(app, { ...token, fetch });
    const image = await writer.addPhoto(7, 1501, {
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      filename: "02-in-use.jpg",
      rank: 2,
    });
    expect(image.listing_image_id).toBe(88);
    const body = fetch.mock.calls[0][1]?.body as FormData;
    expect(body.get("rank")).toBe("2");
    const file = body.get("image") as File;
    expect(file.name).toBe("02-in-use.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty("content-type");

    const gone = stub(() => new Response(null, { status: 204 }));
    await etsyDrafts(app, { ...token, fetch: gone }).removePhoto(7, 1501, 88);
    expect(gone.mock.calls[0][1]?.method).toBe("DELETE");
    expect(String(gone.mock.calls[0][0])).toMatch(
      /\/shops\/7\/listings\/1501\/images\/88$/,
    );
  });

  it("names the shop's shipping and processing profiles", async () => {
    const shipping = stub(() =>
      json(200, {
        count: 2,
        results: [
          { shipping_profile_id: 3, title: "US standard" },
          { shipping_profile_id: 4, title: null, is_deleted: true },
        ],
      }),
    );
    expect(
      await etsyDrafts(app, { ...token, fetch: shipping }).shippingProfiles(7),
    ).toEqual([{ id: 3, label: "US standard" }]);
    const processing = stub(() =>
      json(200, {
        count: 1,
        results: [
          {
            readiness_state_id: 5,
            readiness_state: "made_to_order",
            processing_days_display_label: "3-5 days",
          },
        ],
      }),
    );
    expect(
      await etsyDrafts(app, {
        ...token,
        fetch: processing,
      }).processingProfiles(7),
    ).toEqual([{ id: 5, label: "Made to order · 3-5 days" }]);
  });
});

describe("one price and quantity for a draft", () => {
  const offering = {
    quantity: 3,
    is_enabled: true,
    price: { amount: 4800, divisor: 100, currency_code: "USD" },
    readiness_state_id: 5,
  };

  it("keeps the draft's SKU and processing profile", () => {
    expect(
      singleOffering(
        {
          products: [
            { sku: "OAK-1", property_values: [], offerings: [offering] },
          ],
        },
        { price: 52, quantity: 8 },
      ),
    ).toEqual({
      products: [
        {
          sku: "OAK-1",
          property_values: [],
          offerings: [
            {
              price: 52,
              quantity: 8,
              is_enabled: true,
              readiness_state_id: 5,
            },
          ],
        },
      ],
    });
  });

  it("refuses a draft with variations: one product would wipe them", () => {
    expect(
      singleOffering(
        {
          products: [
            { sku: "A", property_values: [{}], offerings: [offering] },
            { sku: "B", property_values: [{}], offerings: [offering] },
          ],
        },
        { price: 52, quantity: 8 },
      ),
    ).toBeNull();
  });
});

describe("the connection's scopes", () => {
  it("asks to write listings and never to delete one", () => {
    expect([...ETSY_SCOPES]).toEqual([
      "shops_r",
      "listings_r",
      "transactions_r",
      "listings_w",
    ]);
    expect(ETSY_SCOPES).not.toContain("listings_d");
    expect(draftsAllowed("shops_r listings_r transactions_r")).toBe(false);
    expect(draftsAllowed(ETSY_SCOPES.join(" "))).toBe(true);
  });
});

describe("the mock shop's drafts", () => {
  it("keeps what Kiln makes and changes, live listings readable as live", async () => {
    const drafts = mockEtsyDrafts({
      store: newMockDraftStore(),
      now: () => new Date("2026-11-02T12:00:00Z"),
    });
    const before = await drafts.drafts(MOCK_SHOP_ID, { limit: 25, offset: 0 });
    expect(before.count).toBe(2);
    const made = await drafts.createDraft(MOCK_SHOP_ID, fields);
    expect(made).toMatchObject({ state: "draft", price: { amount: 4800 } });
    await drafts.updateDraft(MOCK_SHOP_ID, made.listing_id, {
      title: "Oak board, oiled",
    });
    await drafts.setInventory(made.listing_id, {
      products: [
        {
          sku: "",
          property_values: [],
          offerings: [
            {
              price: 52,
              quantity: 4,
              is_enabled: true,
              readiness_state_id: null,
            },
          ],
        },
      ],
    });
    const photo = await drafts.addPhoto(MOCK_SHOP_ID, made.listing_id, {
      bytes: new Uint8Array([255, 216, 255]),
      mime: "image/jpeg",
      filename: "01-hero.jpg",
      rank: 1,
    });
    const after = await drafts.listing(made.listing_id);
    expect(after).toMatchObject({
      title: "Oak board, oiled",
      price: { amount: 5200 },
      quantity: 4,
    });
    expect(after.images).toHaveLength(1);
    await drafts.removePhoto(
      MOCK_SHOP_ID,
      made.listing_id,
      photo.listing_image_id as number,
    );
    expect((await drafts.listing(made.listing_id)).images).toEqual([]);
    expect(
      (await drafts.drafts(MOCK_SHOP_ID, { limit: 25, offset: 0 })).results[0]
        .listing_id,
    ).toBe(made.listing_id);
    const live = await drafts.listing(MOCK_SHOP_ID * 1000 + 1);
    expect(live.state).toBe("active");
    const varied = await drafts.inventory(MOCK_SHOP_ID * 1000 + 502);
    expect(varied.products).toHaveLength(3);
  });

  it("offers its categories with the path down to each", () => {
    const choices = flattenTaxonomy(MOCK_TAXONOMY);
    expect(choices.find((c) => c.id === 1063)?.path).toEqual([
      "Home & Living",
      "Kitchen & Dining",
      "Coasters",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { shopsHref, windowLabel, windowSince } from "@/lib/shops-view";

describe("Shops addresses", () => {
  const query = { window: 90, by: "orders", shops: "recent" } as const;

  it("leaves the defaults out", () => {
    expect(shopsHref(query)).toBe("/shops");
    expect(shopsHref(query, { window: 30 })).toBe("/shops?window=30");
  });

  it("keeps what the maker chose while changing one thing", () => {
    const chosen = { window: 365, by: "units", shops: "lifetime" } as const;
    expect(shopsHref(chosen, { by: "revenue" })).toBe(
      "/shops?window=365&by=revenue&shops=lifetime",
    );
    expect(shopsHref(chosen, { fresh: true })).toBe(
      "/shops?window=365&by=units&shops=lifetime&fresh=1",
    );
  });

  it("names a window", () => {
    expect(windowLabel(30)).toBe("30 days");
    expect(windowLabel(365)).toBe("Year");
    expect(windowSince(365)).toBe("the last year");
  });
});

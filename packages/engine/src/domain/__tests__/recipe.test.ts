import { describe, expect, it } from "vitest";
import { DestinationProfile } from "@/domain/destination";
import { composePreset, composeRecipe } from "@/domain/recipe";
import { ShotList } from "@/domain/shot-list";

const shop = DestinationProfile.parse({
  id: "shop",
  name: "Shop",
  kind: "sale",
  formats: [
    { key: "square", label: "Square", aspect: "1:1" },
    { key: "tall", label: "Tall", aspect: "4:5" },
  ],
  rules: { textOnImage: "forbidden", negative: ["text overlay", "watermark"] },
  delivery: { mode: "export" },
});

const list = ShotList.parse({
  id: "shop-kit",
  name: "Shop kit",
  destinationId: "shop",
  fieldDefaults: { scene: "sweep" },
  preserve: ["product shape"],
  negative: ["watermark", "clutter"],
  slots: [
    { key: "hero", label: "Hero", purpose: "Win the click.", aspect: "1:1" },
    {
      key: "colours",
      label: "Colours",
      purpose: "Every colour.",
      fill: "exact",
      exact: "colour-grid",
    },
    { key: "detail", label: "Detail", purpose: "Prove the craft." },
  ],
});

describe("composeRecipe", () => {
  const recipe = composeRecipe({
    id: "r",
    name: "R",
    shotList: list,
    destination: shop,
  });

  it("turns only scene slots into directions, keeping order and aspect", () => {
    expect(recipe.directions).toEqual([
      { label: "Hero", purpose: "Win the click.", aspect: "1:1" },
      { label: "Detail", purpose: "Prove the craft." },
    ]);
  });

  it("carries a slot's knobs into its direction", () => {
    const tuned = ShotList.parse({
      ...list,
      slots: [
        {
          key: "hero",
          label: "Hero",
          purpose: "Win the click.",
          knobs: { distance: "close", light: "studio" },
        },
      ],
    });
    expect(
      composeRecipe({ id: "r", name: "R", shotList: tuned, destination: shop })
        .directions[0].knobs,
    ).toEqual({ distance: "close", light: "studio" });
  });

  it("merges destination then shot-list negatives without duplicates", () => {
    expect(recipe.constraints.negative).toEqual([
      "text overlay",
      "watermark",
      "clutter",
    ]);
    expect(recipe.constraints.preserve).toEqual(["product shape"]);
  });

  it("derives targets from the destination formats unless given", () => {
    expect(recipe.targets.map((t) => t.aspect)).toEqual(["1:1", "4:5"]);
    const explicit = composeRecipe({
      id: "r",
      name: "R",
      shotList: list,
      destination: shop,
      targets: [{ name: "X", aspect: "2:3" }],
    });
    expect(explicit.targets).toEqual([{ name: "X", aspect: "2:3" }]);
  });

  it("without a destination, targets are the distinct slot aspects", () => {
    const brief = ShotList.parse({ ...list, destinationId: null });
    const r = composeRecipe({
      id: "b",
      name: "B",
      shotList: brief,
      destination: null,
    });
    expect(r.targets).toEqual([{ name: "Shop kit", aspect: "1:1" }]);
    expect(r.constraints.negative).toEqual(["watermark", "clutter"]);
  });

  it("refuses a destination the shot list does not target", () => {
    expect(() =>
      composeRecipe({ id: "r", name: "R", shotList: list, destination: null }),
    ).toThrow();
  });
});

describe("composePreset", () => {
  const catalog = { shotLists: [list], destinations: [shop] };
  const base = {
    id: "p",
    name: "P",
    shotListId: "shop-kit",
    destinationId: "shop",
    targets: [{ name: "Shop", aspect: "1:1" }],
  };

  it("resolves a preset against the catalog", () => {
    expect(composePreset(base, catalog).id).toBe("p");
  });

  it("throws on an unknown shot list or destination", () => {
    expect(() =>
      composePreset({ ...base, shotListId: "nope" }, catalog),
    ).toThrow();
    expect(() =>
      composePreset({ ...base, destinationId: "nope" }, catalog),
    ).toThrow();
  });
});

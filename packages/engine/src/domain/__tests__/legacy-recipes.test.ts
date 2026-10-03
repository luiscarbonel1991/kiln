import { describe, expect, it } from "vitest";
import { SEED_RECIPES } from "@/domain/seed";
import legacy from "./fixtures/legacy-recipes.json";

// Golden parity: the recipes the studio editor consumes must not change when the
// seeds are re-expressed as destination profiles + shot lists. The fixture is the
// verbatim output of SEED_RECIPES before that split (2026-10-02).
describe("legacy recipes (golden)", () => {
  it("SEED_RECIPES equals the frozen pre-split recipes, in order", () => {
    expect(SEED_RECIPES).toEqual(legacy);
  });

  it("keeps the Planning chip text for every recipe", () => {
    const chip = (r: { targets: { aspect: string }[] }) =>
      r.targets.map((t) => t.aspect).join(" · ");
    expect(SEED_RECIPES.map(chip)).toEqual(legacy.map(chip));
  });
});

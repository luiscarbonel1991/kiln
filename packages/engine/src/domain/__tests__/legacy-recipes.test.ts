import { describe, expect, it } from "vitest";
import { SEED_RECIPES } from "@/domain/seed";
import legacy from "./fixtures/legacy-recipes.json";

// Golden: the recipes the studio editor consumes change only on purpose. The
// fixture was the verbatim output of SEED_RECIPES before the destination /
// shot-list split (2026-10-02, parity); since then it is regenerated only by an
// intended change: M4 (2026-10-05) added each Etsy scene's own art direction.
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

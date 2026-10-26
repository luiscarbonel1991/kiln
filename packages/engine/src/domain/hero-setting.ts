import { z } from "zod";
import type { ProjectPlan } from "@/domain/plan";
import type { Product } from "@/domain/product";

// The marketplace hero's setting (ROADMAP P0-3, DOGFOOD #63): the plan
// proposes it and remembers the maker's choice per destination and product
// family, so the next product of that family starts where the maker left it.

export const HeroSetting = z.enum(["sweep", "place"]);
export type HeroSetting = z.infer<typeof HeroSetting>;

// What a maker's choices are kept as, read leniently: a value a later version
// drops reads as unset.
export const MakerPreferences = z.object({
  heroSetting: z
    .record(z.string(), z.string())
    .catch({})
    .default({})
    .transform(
      (all) =>
        Object.fromEntries(
          Object.entries(all).flatMap(([key, value]) => {
            const setting = HeroSetting.safeParse(value);
            return setting.success ? [[key, setting.data]] : [];
          }),
        ) as Record<string, HeroSetting>,
    ),
});
export type MakerPreferences = z.infer<typeof MakerPreferences>;

export function readPreferences(raw: unknown): MakerPreferences {
  const parsed = MakerPreferences.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { heroSetting: {} };
}

// "etsy:home": a choice is kept per destination and family, whatever its case.
export const heroKey = (destinationId: string, family: string) =>
  `${destinationId}:${family.trim().toLowerCase()}`;

// Where a product is mounted rather than set down: a page-1 hero shows it in
// place.
const MOUNTED =
  /\b(walls?|doors?|doorways?|gates?|porch(es)?|fences?|entry|entryway|entrance|facade|mailbox(es)?)\b/i;

export interface HeroProposal {
  setting: HeroSetting;
  // Why: the maker's own choice for the family, the place the product is
  // mounted in (its first place of use), or Kiln's default.
  source: "remembered" | "mounted" | "default";
  place?: string;
}

export function heroProposal(
  product: Product,
  destinationId: string,
  remembered: Record<string, HeroSetting>,
): HeroProposal {
  const kept = remembered[heroKey(destinationId, product.family)];
  if (kept) return { setting: kept, source: "remembered" };
  const place = product.useContexts[0]?.trim();
  if (place && MOUNTED.test(place)) {
    return { setting: "place", source: "mounted", place };
  }
  return { setting: "sweep", source: "default" };
}

// The plan with each destination's hero set as given (the slots that offer
// the setting knob; a destination left out keeps its default).
export function withHeroSettings(
  plan: ProjectPlan,
  settingFor: (destinationId: string) => HeroSetting | undefined,
): ProjectPlan {
  return {
    destinations: plan.destinations.map((d) => {
      const setting = settingFor(d.destinationId);
      if (!setting) return d;
      return {
        ...d,
        slots: d.slots.map((s) =>
          s.knobs?.setting !== undefined
            ? { ...s, knobs: { ...s.knobs, setting } }
            : s,
        ),
      };
    }),
  };
}

// The destinations whose plan offers a hero setting, with the one it uses.
export function heroSettingsOf(
  plan: ProjectPlan,
): { destinationId: string; setting: HeroSetting }[] {
  return plan.destinations.flatMap((d) => {
    const setting = d.slots.find((s) => s.knobs?.setting !== undefined)?.knobs
      ?.setting;
    return setting === "sweep" || setting === "place"
      ? [{ destinationId: d.destinationId, setting }]
      : [];
  });
}

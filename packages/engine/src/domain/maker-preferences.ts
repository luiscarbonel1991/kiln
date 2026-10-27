import { z } from "zod";
import { HeroSetting } from "@/domain/hero-setting";
import { SearchColumns } from "@/domain/market-brief";

// What a maker's choices are kept as (`Maker.preferences`), read leniently: a
// value a later version drops reads as unset, and the rest still reads.

const lenientRecord = <T extends z.ZodType>(value: T) =>
  z
    .record(z.string(), z.unknown())
    .catch({})
    .default({})
    .transform(
      (all) =>
        Object.fromEntries(
          Object.entries(all).flatMap(([key, raw]) => {
            const parsed = value.safeParse(raw);
            return parsed.success ? [[key, parsed.data]] : [];
          }),
        ) as Record<string, z.infer<T>>,
    );

export const MakerPreferences = z.object({
  // The hero's setting per destination and product family (heroKey).
  heroSetting: lenientRecord(HeroSetting),
  // Which header holds each value of a search table, per source ("EverBee").
  searchColumns: lenientRecord(SearchColumns),
});
export type MakerPreferences = z.infer<typeof MakerPreferences>;

export function readPreferences(raw: unknown): MakerPreferences {
  const parsed = MakerPreferences.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { heroSetting: {}, searchColumns: {} };
}

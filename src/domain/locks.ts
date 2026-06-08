import type { FieldSource } from "@/domain/field";

// Cascade rule: image- and brand-sourced fields start locked at card creation.
export function lockByDefault(source: FieldSource): boolean {
  return source === "image" || source === "brand";
}

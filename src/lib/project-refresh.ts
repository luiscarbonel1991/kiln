import type { Card } from "@/domain/card";

type Fields = Card["fields"];

// A project brought up to its product's current version keeps what the maker
// made of it. Each card takes its fields and its references (the material
// sample) from the card the product now derives, except a field the maker
// wrote (source "local"); its outputs, status, model, prompt override and
// video stay, and it points at the project's reference. A card the product
// no longer derives is left as it was, re-pointed.
export function refreshCards(
  existing: Card[],
  derived: Card[],
  masterAssetId: string,
): Card[] {
  const byId = new Map(derived.map((card) => [card.id, card]));
  return existing.map((card) => {
    const next = byId.get(card.id);
    if (!next) return { ...card, masterAssetId };
    return {
      ...card,
      fields: freshFields(card.fields, next.fields),
      references: next.references,
      masterAssetId,
    };
  });
}

// Every field from the card the product now derives, except one the maker
// wrote (source "local").
export function freshFields(current: Fields, derived: Fields): Fields {
  return Object.fromEntries(
    Object.entries(current).map(([key, field]) => [
      key,
      field.source === "local" ? field : derived[key as keyof Fields],
    ]),
  ) as Fields;
}

// The direction a scene's knobs write. A tuned card takes these from the card
// its slot now derives, except a field the maker wrote; the product's fields
// stay as the project has them.
const TUNED = ["scene", "composition", "lighting"] as const;

export function retuneFields(current: Fields, derived: Fields): Fields {
  const next = { ...current };
  for (const key of TUNED) {
    if (current[key].source !== "local") next[key] = derived[key];
  }
  return next;
}

// The cards that run their own prompt (the editor's override): they do not
// follow the product, so an update says so.
export function cardsWithOwnPrompt(cards: Card[]): string[] {
  return cards
    .filter((card) => (card.promptOverride ?? "").trim() !== "")
    .map((card) => card.id);
}

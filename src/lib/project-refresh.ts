import type { Card } from "@/domain/card";

type Fields = Card["fields"];

// A project brought up to its product's current version keeps what the maker
// made of it. Each card takes its fields from the card the product now
// derives, except a field the maker wrote (source "local"); its outputs,
// status, model, prompt override, references and video stay, and it points
// at the project's reference. A card the product no longer derives is left
// as it was, re-pointed.
export function refreshCards(
  existing: Card[],
  derived: Card[],
  masterAssetId: string,
): Card[] {
  const byId = new Map(derived.map((card) => [card.id, card]));
  return existing.map((card) => {
    const next = byId.get(card.id);
    if (!next) return { ...card, masterAssetId };
    const fields = Object.fromEntries(
      Object.entries(card.fields).map(([key, field]) => [
        key,
        field.source === "local" ? field : next.fields[key as keyof Fields],
      ]),
    ) as Fields;
    return { ...card, fields, masterAssetId };
  });
}

// The cards that run their own prompt (the editor's override): they do not
// follow the product, so an update says so.
export function cardsWithOwnPrompt(cards: Card[]): string[] {
  return cards
    .filter((card) => (card.promptOverride ?? "").trim() !== "")
    .map((card) => card.id);
}

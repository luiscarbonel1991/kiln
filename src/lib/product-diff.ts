import type { Product } from "@/domain/product";

// What changed between two versions of a product, in the maker's words
// ("material", "colours (+Walnut, −Champagne, Oak changed)"): an import says
// what it updated, and a project says what changed since it started. Kiln's
// own row id is not part of the product's content.

type Field = Exclude<keyof Product, "id" | "colours" | "source">;

const FIELDS: [Field, string][] = [
  ["name", "name"],
  ["family", "family"],
  ["description", "description"],
  ["dimensions", "size"],
  ["parts", "parts"],
  ["views", "reference views"],
  ["shape", "shape"],
  ["material", "material"],
  ["treatment", "finish"],
  ["defaultColour", "default colour"],
  ["typography", "typography"],
  ["wording", "text lines"],
  ["icons", "icons"],
  ["variants", "variants"],
  ["forbidden", "things to avoid"],
  ["useContexts", "places of use"],
  ["hook", "hook"],
  ["cta", "call to action"],
  ["price", "price"],
];

// JSON with sorted keys: two objects with the same content compare equal
// whatever order their keys were written in.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function colourChanges(before: Product, after: Product): string | null {
  const old = new Map(before.colours.map((c) => [c.key, c]));
  const now = new Map(after.colours.map((c) => [c.key, c]));
  const parts = [
    ...after.colours.filter((c) => !old.has(c.key)).map((c) => `+${c.name}`),
    ...before.colours.filter((c) => !now.has(c.key)).map((c) => `−${c.name}`),
    ...after.colours
      .filter((c) => old.has(c.key) && !same(old.get(c.key), c))
      .map((c) => `${c.name} changed`),
  ];
  if (parts.length > 0) return `colours (${parts.join(", ")})`;
  const order = (p: Product) => p.colours.map((c) => c.key).join();
  return order(before) === order(after) ? null : "colour order";
}

function sourceChange(before: Product, after: Product): string | null {
  if (same(before.source, after.source)) return null;
  const kind = after.source.kind;
  if (before.source.kind !== kind) return "source";
  return kind === "vector"
    ? "reference drawing"
    : kind === "photo"
      ? "reference photo"
      : "source";
}

export function productChanges(before: Product, after: Product): string[] {
  const changes = FIELDS.flatMap(([key, words]) =>
    same(before[key], after[key]) ? [] : [words],
  );
  const colours = colourChanges(before, after);
  const source = sourceChange(before, after);
  return [
    ...changes,
    ...(colours ? [colours] : []),
    ...(source ? [source] : []),
  ];
}
